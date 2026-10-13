#!/usr/bin/env python
"""Window-only portal capture with lossless video and per-buffer pixel metrics."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid

import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstVideo', '1.0')
from gi.repository import Gio, GLib, Gst, GstVideo
import numpy as np
from analyzer import CardAnalyzer

PORTAL = 'org.freedesktop.portal.Desktop'
PATH = '/org/freedesktop/portal/desktop'
IFACE = 'org.freedesktop.portal.ScreenCast'


def log(message, **fields):
    print(json.dumps({'event': message, 'wall_ns': time.time_ns(),
                      'monotonic_ns': time.monotonic_ns(), **fields}), flush=True)


class Portal:
    def __init__(self):
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None

    def request(self, method, signature, args, options):
        token = 'handy_' + uuid.uuid4().hex
        opts = {**options, 'handle_token': GLib.Variant('s', token)}
        sender = self.bus.get_unique_name()[1:].replace('.', '_')
        request_path = '/org/freedesktop/portal/desktop/request/' + sender + '/' + token
        loop = GLib.MainLoop()
        answer = []
        def response(_bus, _sender, _path, _iface, _signal, params):
            answer.append(params.unpack())
            loop.quit()
        sub = self.bus.signal_subscribe(PORTAL, 'org.freedesktop.portal.Request',
                                       'Response', request_path, None,
                                       Gio.DBusSignalFlags.NONE, response)
        def timeout():
            if not answer:
                answer.append((2, {'error': 'portal response timed out'}))
                loop.quit()
            return GLib.SOURCE_REMOVE
        timer = GLib.timeout_add_seconds(600, timeout)
        try:
            result = self.bus.call_sync(PORTAL, PATH, IFACE, method,
                                        GLib.Variant(signature, (*args, opts)),
                                        GLib.VariantType.new('(o)'),
                                        Gio.DBusCallFlags.NONE, 10000, None)
            actual = result.unpack()[0]
            if actual != request_path:
                raise RuntimeError('Portal returned an unexpected request path: ' + actual)
            loop.run()
            code, values = answer[0]
            if code:
                raise RuntimeError(f'{method} failed: response={code}, details={values}')
            return values
        finally:
            if loop.get_context().find_source_by_id(timer):
                GLib.source_remove(timer)
            self.bus.signal_unsubscribe(sub)

    def prepare(self):
        properties = self.bus.call_sync(PORTAL, PATH, 'org.freedesktop.DBus.Properties',
            'GetAll', GLib.Variant('(s)', (IFACE,)), GLib.VariantType.new('(a{sv})'),
            Gio.DBusCallFlags.NONE, 10000, None).unpack()[0]
        if not properties.get('AvailableSourceTypes', 0) & 2:
            raise RuntimeError('The portal cannot capture windows')
        self.session = self.request('CreateSession', '(a{sv})', (), {
            'session_handle_token': GLib.Variant('s', 'handy_' + uuid.uuid4().hex)
        })['session_handle']
        self.request('SelectSources', '(oa{sv})', (self.session,), {
            'types': GLib.Variant('u', 2), 'multiple': GLib.Variant('b', False),
            'cursor_mode': GLib.Variant('u', 1), 'persist_mode': GLib.Variant('u', 0)
        })
        log('portal_prepared', properties=properties, capture_types='WINDOW only',
            cursor='hidden', persistent_permission=False)

    def start(self):
        log('portal_dialog', instruction='Select only the Handy Recording window, then select Share.')
        result = self.request('Start', '(osa{sv})', (self.session, ''), {})
        streams = result['streams']
        if len(streams) != 1:
            raise RuntimeError('Expected exactly one window stream')
        node, properties = streams[0]
        if properties.get('source_type') != 2:
            raise RuntimeError('The portal did not prove that the selected stream is a window')
        result, fd_list = self.bus.call_with_unix_fd_list_sync(PORTAL, PATH, IFACE,
            'OpenPipeWireRemote', GLib.Variant('(oa{sv})', (self.session, {})),
            GLib.VariantType.new('(h)'), Gio.DBusCallFlags.NONE, 10000, None, None)
        fd = fd_list.get(result.unpack()[0])
        log('portal_stream', node=node, properties=properties)
        return fd, node, properties

    def close(self):
        if self.session:
            try:
                self.bus.call_sync(PORTAL, self.session, 'org.freedesktop.portal.Session',
                    'Close', None, None, Gio.DBusCallFlags.NONE, 3000, None)
            except GLib.Error:
                pass
            self.session = None


def capture(args, output, fd=None, node=None, properties=None):
    Gst.init(None)
    loop = GLib.MainLoop()
    if args.synthetic:
        source = 'videotestsrc is-live=true pattern=ball'
        input_caps = f'video/x-raw,width=400,height=200,framerate={args.fps}/1'
    else:
        source = f'pipewiresrc fd={fd} path={node} do-timestamp=false keepalive-time=0'
        # KWin window streams may advertise a variable frame rate (0/1).
        # Accept native caps and measure actual delivered frames.
        input_caps = 'video/x-raw'
    description = (source + ' ! ' + input_caps + ' ! videoconvert ! '
        'video/x-raw,format=BGRA ! identity name=guard ! tee name=split '
        'split. ! queue ! avenc_ffv1 ! matroskamux ! filesink name=record '
        'split. ! queue ! appsink name=metrics emit-signals=true sync=false '
        'max-buffers=8 drop=false')
    pipeline = Gst.parse_launch(description)
    pipeline.get_by_name('record').set_property('location', str(output / 'overlay.mkv'))
    file = (output / 'frames.jsonl').open('w')
    rows = []
    previous = None
    previous_pts = None
    errors = []
    first = None
    deadline = None
    stopping = False
    invalid_caps = False
    last_hash = None
    analyzer = None
    trigger_ns = None

    def stop(reason):
        nonlocal stopping
        if not stopping:
            stopping = True
            log('capture_stop', reason=reason)
            pipeline.send_event(Gst.Event.new_eos())
            GLib.timeout_add_seconds(5, lambda: (loop.quit(), GLib.SOURCE_REMOVE)[1])
        return GLib.SOURCE_REMOVE

    def guard(_pad, probe):
        nonlocal invalid_caps
        if invalid_caps and probe.type & Gst.PadProbeType.BUFFER:
            return Gst.PadProbeReturn.DROP
        if probe.type & Gst.PadProbeType.EVENT_DOWNSTREAM:
            event = probe.get_event()
            if event.type == Gst.EventType.CAPS:
                caps = event.parse_caps()
                info = GstVideo.VideoInfo.new_from_caps(caps)
                if invalid_caps:
                    return Gst.PadProbeReturn.DROP
                if info.width > args.max_width or info.height > args.max_height:
                    invalid_caps = True
                    errors.append(f'Selected window {info.width}x{info.height} exceeds the overlay size limit')
                    GLib.idle_add(stop, 'size_guard')
                    return Gst.PadProbeReturn.DROP
        return Gst.PadProbeReturn.OK
    pipeline.get_by_name('guard').get_static_pad('src').add_probe(
        Gst.PadProbeType.EVENT_DOWNSTREAM | Gst.PadProbeType.BUFFER, guard)

    def sample(sink):
        nonlocal previous, previous_pts, first, deadline, last_hash, analyzer, trigger_ns
        value = sink.emit('pull-sample')
        buffer = value.get_buffer()
        now = time.monotonic_ns()
        wall = time.time_ns()
        info = GstVideo.VideoInfo.new_from_caps(value.get_caps())
        mapped, mapping = buffer.map(Gst.MapFlags.READ)
        if not mapped:
            errors.append('Cannot map a frame')
            GLib.idle_add(stop, 'map_error')
            return Gst.FlowReturn.ERROR
        try:
            frame = np.ndarray((info.height, info.width, 4), np.uint8,
                buffer=mapping.data, offset=info.offset[0], strides=(info.stride[0], 4, 1)).copy()
        finally:
            buffer.unmap(mapping)
        rgb = frame[:, :, :3]
        gray = (rgb[:, :, 0].astype(np.float32) * .0722 +
                rgb[:, :, 1].astype(np.float32) * .7152 +
                rgb[:, :, 2].astype(np.float32) * .2126)
        digest = hashlib.blake2s(frame.tobytes(), digest_size=8).hexdigest()
        pts = None if buffer.pts == Gst.CLOCK_TIME_NONE else int(buffer.pts)
        delta = None if previous is None or previous.shape != gray.shape else np.abs(gray - previous)
        row = {'frame': len(rows), 'wall_ns': wall, 'monotonic_ns': now,
               'gst_pts_ns': pts, 'width': info.width, 'height': info.height,
               'pixel_hash': digest, 'duplicate_pixels': digest == last_hash,
               'mean_luma': float(gray.mean()), 'std_luma': float(gray.std()),
               'dark_pixel_ratio': float((gray < 8).mean()),
               'bright_pixel_ratio': float((gray > 245).mean()),
               'transparent_ratio': float((frame[:, :, 3] == 0).mean()),
               'top_luma': float(gray[:max(1, info.height // 4)].mean()),
               'center_luma': float(gray[info.height // 4:3 * info.height // 4,
                                             info.width // 4:3 * info.width // 4].mean()),
               'bottom_luma': float(gray[3 * info.height // 4:].mean()),
               'mean_abs_luma_delta': None if delta is None else float(delta.mean()),
               'changed_pixel_ratio': None if delta is None else float((delta > 12).mean()),
               'pts_gap_ms': None if pts is None or previous_pts is None else (pts - previous_pts) / 1e6,
               'discontinuity': bool(buffer.has_flags(Gst.BufferFlags.DISCONT))}
        row['replay_phase'] = 'warmup'
        if first is not None and analyzer is None and now - first >= 1_000_000_000:
            try:
                analyzer = CardAnalyzer(frame)
                log('pixel_baseline', bounds=analyzer.bounds, ink_pixels=analyzer.ink_reference)
            except ValueError as error:
                log('pixel_baseline_error', error=str(error))
            if args.trigger:
                args.trigger.parent.mkdir(parents=True, exist_ok=True)
                trigger_ns = time.monotonic_ns()
                args.trigger.write_text(json.dumps({'wall_ns': time.time_ns(), 'monotonic_ns': trigger_ns}) + '\n')
                log('replay_trigger', path=str(args.trigger), trigger_monotonic_ns=trigger_ns)
        if analyzer is not None:
            row.update(analyzer.measure(frame))
        row['replay_elapsed_ms'] = None if trigger_ns is None else (now - trigger_ns) / 1e6
        if trigger_ns is not None:
            t = (now - trigger_ns) / 1e9
            row['replay_phase'] = ('moving_wave_fixed_text' if t < 10 else
                'silent_fixed_text' if t < 20 else 'moving_wave_changing_text' if t < 30 else 'complete')
            stable = 1 < t < 29.5 and all(abs(t - edge) > .5 for edge in [10, 20])
            row['card_loss_candidate'] = bool(stable and row.get('card_loss_ratio', 0) > .6)
            row['text_loss_candidate'] = bool(stable and t < 19.5 and row.get('text_ink_ratio', 1) < .3)
        else:
            row['card_loss_candidate'] = False
            row['text_loss_candidate'] = False
        if row['card_loss_candidate'] or row['text_loss_candidate']:
            log('pixel_loss_candidate', frame=row['frame'], phase=row['replay_phase'],
                card_loss_ratio=row.get('card_loss_ratio'), text_ink_ratio=row.get('text_ink_ratio'),
                accent_pixels=row.get('accent_pixels'))
        file.write(json.dumps(row) + '\n')
        file.flush()
        rows.append(row)
        previous, previous_pts, last_hash = gray, pts, digest
        if first is None:
            first = now
            log('capture_first_frame', dimensions=[info.width, info.height], caps=value.get_caps().to_string())
            deadline = GLib.timeout_add(int(args.seconds * 1000), stop, 'duration')
        elif row['changed_pixel_ratio'] is not None and row['changed_pixel_ratio'] > .35:
            log('large_pixel_change', frame=row['frame'], pts_ns=pts,
                changed_pixel_ratio=row['changed_pixel_ratio'], mean_luma=row['mean_luma'])
        return Gst.FlowReturn.OK

    pipeline.get_by_name('metrics').connect('new-sample', sample)
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    def message(_bus, msg):
        if msg.type == Gst.MessageType.ERROR:
            error, debug = msg.parse_error()
            errors.append(str(error) + ' ' + str(debug))
            loop.quit()
        elif msg.type == Gst.MessageType.EOS:
            loop.quit()
    bus.connect('message', message)
    signal.signal(signal.SIGINT, lambda *_: GLib.idle_add(stop, 'interrupt'))
    signal.signal(signal.SIGTERM, lambda *_: GLib.idle_add(stop, 'terminate'))
    log('capture_start', output=str(output), fps_requested=args.fps,
        source='synthetic' if args.synthetic else 'portal_window',
        duration_from_first_frame_seconds=args.seconds)
    pipeline.set_state(Gst.State.PLAYING)
    watchdog = GLib.timeout_add_seconds(15, lambda: stop('no_frames') if first is None else GLib.SOURCE_REMOVE)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)
        file.close()
    elapsed = (rows[-1]['monotonic_ns'] - rows[0]['monotonic_ns']) / 1e9 if len(rows) > 1 else 0
    gaps = [row['pts_gap_ms'] for row in rows if row['pts_gap_ms'] is not None]
    summary = {'source': 'synthetic' if args.synthetic else 'portal_window',
        'fps_requested': args.fps, 'frame_count': len(rows),
        'elapsed_seconds': elapsed, 'delivered_fps': (len(rows) - 1) / elapsed if elapsed else 0,
        'unique_pixel_frames': sum(not row['duplicate_pixels'] for row in rows),
        'max_pts_gap_ms': max(gaps) if gaps else None,
        'large_change_frames': [row['frame'] for row in rows if (row['changed_pixel_ratio'] or 0) > .35],
        'errors': errors, 'stream_properties': properties,
        'expected_frames_if_continuous': round(args.seconds * args.fps),
        'phases': {},
        'replay_trigger_monotonic_ns': trigger_ns,
        'card_loss_candidates': [row['frame'] for row in rows if row['card_loss_candidate']],
        'text_loss_candidates': [row['frame'] for row in rows if row['text_loss_candidate']],
        'limitations': ['Window capture does not include final monitor scanout or HDR display output.',
            'Pixel changes identify candidates, not proof of flicker.',
            'No frames are duplicated to manufacture the requested frame rate.']}
    for phase in sorted(set(row['replay_phase'] for row in rows)):
        selected = [row for row in rows if row['replay_phase'] == phase]
        span = (selected[-1]['monotonic_ns'] - selected[0]['monotonic_ns']) / 1e9 if len(selected) > 1 else 0
        summary['phases'][phase] = {'frames': len(selected), 'observed_span_seconds': span,
            'delivered_fps': (len(selected) - 1) / span if span else 0,
            'unique_pixel_frames': sum(not row['duplicate_pixels'] for row in selected),
            'max_card_loss_ratio': max(row.get('card_loss_ratio', 0) for row in selected),
            'min_text_ink_ratio': min(row.get('text_ink_ratio', 1) for row in selected)}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    log('capture_complete', **summary)
    return 1 if errors or not rows else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preflight', action='store_true', help='Check portal session setup without showing a selection dialog')
    parser.add_argument('--synthetic', action='store_true', help='Test metrics and video using generated frames')
    parser.add_argument('--seconds', type=float, default=30)
    parser.add_argument('--fps', type=int, choices=[30, 60], default=60)
    parser.add_argument('--max-width', type=int, default=800)
    parser.add_argument('--max-height', type=int, default=400)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--trigger', type=Path, help='Create the replay trigger after one second of captured frames')
    args = parser.parse_args()
    if not 0 < args.seconds <= 600:
        parser.error('--seconds must be between 0 and 600')
    if args.trigger and args.trigger.exists():
        parser.error('The replay trigger already exists. Use a fresh trigger path.')
    output = args.output or Path('/tmp/handy-overlay-capture') / time.strftime('capture-%Y%m%d-%H%M%S')
    portal = None
    fd = None
    try:
        if not args.synthetic:
            portal = Portal()
            portal.prepare()
            if args.preflight:
                return 0
            fd, node, props = portal.start()
        else:
            node, props = None, None
        output.mkdir(parents=True, exist_ok=False)
        return capture(args, output, fd, node, props)
    except Exception as error:
        log('capture_error', error=str(error))
        return 1
    finally:
        if fd is not None:
            os.close(fd)
        if portal:
            portal.close()

if __name__ == '__main__':
    sys.exit(main())
