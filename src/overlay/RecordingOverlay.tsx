import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands, events } from "@/bindings";
import type {
  StreamPhase,
  StreamPhaseEvent,
  StreamTextEvent,
  StreamWorkKind,
} from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState =
  | "recording"
  | "streaming"
  | "transcribing"
  | "processing"
  | "text_processing";

// Number of reactive bars in the waveform (the simple, smoothed style shared by
// every overlay form). Mic levels arrive as 16 FFT buckets; we take the first N.
const WAVE_BARS = 9;

const diagnosticNodeIds = new WeakMap<Element, number>();
let nextDiagnosticNodeId = 1;

const describeOverlayElement = (element: Element | null) => {
  if (!element) return null;
  let nodeId = diagnosticNodeIds.get(element);
  if (nodeId === undefined) {
    nodeId = nextDiagnosticNodeId++;
    diagnosticNodeIds.set(element, nodeId);
  }
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    nodeId,
    tag: element.tagName,
    classes: element.className,
    opacity: style.opacity,
    visibility: style.visibility,
    display: style.display,
    backgroundColor: style.backgroundColor,
    color: style.color,
    transform: style.transform,
    overflow: style.overflow,
    maskImage: style.getPropertyValue("mask-image"),
    webkitMaskImage: style.getPropertyValue("-webkit-mask-image"),
    gridTemplateRows: style.gridTemplateRows,
    willChange: style.willChange,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  };
};

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  // `Stream::play()` returning does not mean hardware callbacks are flowing.
  // Stay visually in an arming state until the backend processes the first
  // actual microphone sample chunk.
  const [captureReady, setCaptureReady] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(WAVE_BARS).fill(0));
  const [streamText, setStreamText] = useState<StreamTextEvent>({
    committed: "",
    tentative: "",
  });
  const [phase, setPhase] = useState<StreamPhase>("listening");
  const [workKind, setWorkKind] = useState<StreamWorkKind>("transcribing");
  const [elapsed, setElapsed] = useState(0);
  // Bumped on each new streaming session so the Live card remounts fresh (replays
  // the pop-in, and never animates in from the previous panel's open size).
  const [session, setSession] = useState(0);
  // Overlay placement (top vs bottom of the screen). The Live panel grows downward
  // from a top overlay (oldest line under the pill) and upward from a bottom one.
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  // True once live text overflows the cap. A top overlay fades its top edge only
  // while overflowing, so the resting first line stays crisp flush under the pill.
  const [overflowing, setOverflowing] = useState(false);

  const smoothedLevelsRef = useRef<number[]>(Array(16).fill(0));
  // Live-text scroll-back: the text region "sticks" to the newest line while the
  // user is at the bottom; if they scroll up to read history, auto-follow pauses
  // until they scroll back down.
  const capRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const direction = getLanguageDirection(i18n.language);

  const diagnosticSnapshotRef = useRef({
    isVisible,
    state,
    session,
    phase,
    workKind,
    captureReady,
    elapsed,
    position,
    overflowing,
    committedLength: streamText.committed.length,
    tentativeLength: streamText.tentative.length,
  });
  diagnosticSnapshotRef.current = {
    isVisible,
    state,
    session,
    phase,
    workKind,
    captureReady,
    elapsed,
    position,
    overflowing,
    committedLength: streamText.committed.length,
    tentativeLength: streamText.tentative.length,
  };

  const postDiagnostics = useCallback(
    (
      event: string,
      metadata: Record<string, string | number | boolean> = {},
    ) => {
      if (!import.meta.env.DEV) return;
      const card = document.querySelector(".scard");
      const bars = Array.from(document.querySelectorAll(".swave i"));
      const barHeights = bars.map((bar) => bar.getBoundingClientRect().height);
      const ancestors: ReturnType<typeof describeOverlayElement>[] = [];
      for (
        let ancestor = card?.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        ancestors.push(describeOverlayElement(ancestor));
      }
      const payload = {
        event,
        metadata,
        timestamp: Date.now(),
        performanceTime: performance.now(),
        snapshot: diagnosticSnapshotRef.current,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        card: describeOverlayElement(card),
        text: describeOverlayElement(document.querySelector(".stext")),
        textClip: describeOverlayElement(document.querySelector(".stext-clip")),
        textCap: describeOverlayElement(document.querySelector(".stext-cap")),
        waveform: describeOverlayElement(document.querySelector(".swave")),
        dot: describeOverlayElement(document.querySelector(".sdot")),
        waveBars: {
          count: bars.length,
          minHeight: barHeights.length ? Math.min(...barHeights) : null,
          maxHeight: barHeights.length ? Math.max(...barHeights) : null,
          bars: bars.map(describeOverlayElement),
        },
        cardAncestors: ancestors,
      };
      void fetch("/__overlay_diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let showGeneration = 0;
    const unlisteners: UnlistenFn[] = [];
    const registerListener = async (subscribe: () => Promise<UnlistenFn>) => {
      if (disposed) return;
      const unlisten = await subscribe();
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    const setupEventListeners = async () => {
      await registerListener(() =>
        listen("show-overlay", async (event) => {
          if (disposed) return;
          const generation = ++showGeneration;
          const overlayState = event.payload as OverlayState;
          postDiagnostics("show-overlay", {
            overlayState,
            eventId: event.id,
            generation,
          });
          // Reset before settings I/O so recording-ready cannot be overwritten.
          if (overlayState === "recording" || overlayState === "streaming") {
            setCaptureReady(false);
            smoothedLevelsRef.current = Array(16).fill(0);
            setLevels(Array(WAVE_BARS).fill(0));
            setStreamText({ committed: "", tentative: "" });
          }
          // Event order controls the UI. Settings reads must not restore an old
          // state after a newer show, hide, readiness, or working-phase event.
          setState(overlayState);
          if (overlayState === "streaming") {
            pinnedRef.current = true;
            setOverflowing(false);
            setPhase("listening");
            setWorkKind("transcribing");
            setElapsed(0);
            setSession((s) => s + 1);
          }
          setIsVisible(true);

          await syncLanguageFromSettings();
          if (disposed || generation !== showGeneration) return;
          try {
            const settings = await commands.getAppSettings();
            if (disposed || generation !== showGeneration) return;
            if (settings.status === "ok") {
              setPosition(
                settings.data.overlay_position === "top" ? "top" : "bottom",
              );
            }
          } catch {
            // Keep the previous/default placement if settings can't be read.
          }
        }),
      );

      await registerListener(() =>
        listen("hide-overlay", (event) => {
          if (disposed) return;
          ++showGeneration;
          postDiagnostics("hide-overlay", {
            eventId: event.id,
            generation: showGeneration,
          });
          setIsVisible(false);
          setCaptureReady(false);
        }),
      );

      await registerListener(() =>
        listen("recording-ready", (event) => {
          if (disposed) return;
          postDiagnostics("recording-ready", { eventId: event.id });
          setElapsed(0);
          setCaptureReady(true);
        }),
      );

      await registerListener(() =>
        listen<number[]>("mic-level", (event) => {
          if (disposed) return;
          const newLevels = event.payload as number[];
          const smoothed = smoothedLevelsRef.current.map((prev, i) => {
            const target = newLevels[i] || 0;
            return prev * 0.7 + target * 0.3;
          });
          smoothedLevelsRef.current = smoothed;
          setLevels(smoothed.slice(0, WAVE_BARS));
        }),
      );

      await registerListener(() =>
        events.streamTextEvent.listen((event) => {
          if (disposed) return;
          postDiagnostics("stream-text", {
            eventId: event.id,
            committedLength: event.payload.committed.length,
            tentativeLength: event.payload.tentative.length,
          });
          setStreamText(event.payload);
        }),
      );

      await registerListener(() =>
        events.streamPhaseEvent.listen((event) => {
          if (disposed) return;
          const payload: StreamPhaseEvent = event.payload;
          postDiagnostics("stream-phase", {
            eventId: event.id,
            phase: payload.phase,
            kind: payload.kind ?? "",
          });
          setPhase(payload.phase);
          if (payload.kind) setWorkKind(payload.kind);
        }),
      );
    };

    void setupEventListeners().catch((error) => {
      console.error("Failed to set up overlay listeners:", error);
    });
    return () => {
      disposed = true;
      ++showGeneration;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [postDiagnostics]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const probe = document.createElement("div");
    probe.className = "scard";
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none";
    const cap = document.createElement("div");
    cap.className = "stext-cap";
    probe.append(cap);
    document.body.append(probe);
    const metadata = {
      build: "overlay-mask-test-v1",
      url: window.location.href,
      cardWillChange: getComputedStyle(probe).willChange,
      textMask: getComputedStyle(cap).getPropertyValue("mask-image"),
      textWebkitMask:
        getComputedStyle(cap).getPropertyValue("-webkit-mask-image"),
    };
    probe.remove();
    postDiagnostics("build-ready", metadata);
  }, [postDiagnostics]);

  useEffect(() => {
    if (!import.meta.env.DEV || !isVisible) return;
    postDiagnostics("visible");
    const id = setInterval(() => postDiagnostics("sample"), 1000);
    return () => clearInterval(id);
  }, [isVisible, postDiagnostics]);

  // Elapsed capture timer starts only once microphone samples are flowing.
  useEffect(() => {
    if (state !== "streaming" || !isVisible || !captureReady) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state, isVisible, captureReady]);

  // Stick to the bottom as text streams in — but only while pinned, so a user who
  // has scrolled up to read history isn't yanked back down by the next chunk.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    // Fade the top edge only once text actually overflows the cap.
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [streamText, isVisible, state, session, position]);

  if (!isVisible) return null;

  // Re-pin when the user is within ~a line of the bottom; unpin otherwise.
  const handleStreamScroll = () => {
    const el = capRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 16;
  };

  const fmtTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---- Shared building blocks (one visual language for every overlay form) ----
  const waveform = (
    <div className={`swave ${captureReady ? "ready" : "arming"}`}>
      {levels.map((v, i) => (
        <i
          key={i}
          style={{
            height: `${Math.max(3, Math.min(18, 3 + Math.pow(v, 0.7) * 15))}px`,
          }}
        />
      ))}
    </div>
  );

  const cancelBtn = (
    <button
      className="sx"
      aria-label="cancel"
      onClick={() => commands.cancelOperation()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 4 L12 12 M12 4 L4 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  // dot (left) | waveform (center) | timer + cancel (right) — same structure for
  // pill & panel, so the Live morph is a pure width change.
  const listeningRow = (showTimer: boolean, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className={`sdot ${captureReady ? "ready" : "arming"}`} />
      </div>
      {waveform}
      <div className="sbase-r">
        {showTimer && <span className="stimer">{fmtTime(elapsed)}</span>}
        {showCancel && cancelBtn}
      </div>
    </div>
  );

  // spinner (left) | label (center) | cancel (right) — same 3-zone grid as the
  // listening row, so the label is centered.
  const workingRow = (label: string, showCancel: boolean) => (
    <div className="sbase">
      <div className="sbase-l">
        <span className="sspinner" />
      </div>
      <span className="swork-label">{label}</span>
      <div className="sbase-r">{showCancel && cancelBtn}</div>
    </div>
  );

  // ---- Live overlay: a pill that sculpts open into a panel ----
  if (state === "streaming") {
    const hasText =
      streamText.committed.length > 0 || streamText.tentative.length > 0;
    const working = phase === "working";
    // Keep the panel open whenever there's text — even while finalizing — so the
    // transcript stays put under a working spinner instead of collapsing and
    // squishing the text mid-stream. Only fall back to the small working pill
    // when there was no text to preserve.
    const open = hasText;
    const collapsed = working && !hasText;

    return (
      <div dir={direction} className={`ov-stage ${position}`}>
        <div
          key={session}
          className={`scard ${open ? "open" : ""} ${collapsed ? "working" : ""} ${
            isVisible ? "" : "leaving"
          }`}
        >
          <div className="stext">
            <div className="stext-clip">
              <div
                className={`stext-cap ${overflowing ? "overflowing" : ""}`}
                ref={capRef}
                onScroll={handleStreamScroll}
              >
                <p>
                  <span className="committed">
                    {streamText.committed ? streamText.committed + " " : ""}
                  </span>
                  <span className="tentative">{streamText.tentative}</span>
                  {/* Drop the blinking caret once finalizing — it's no longer
                      capturing, and a static spinner conveys the work. */}
                  {!working && <span className="scaret" />}
                </p>
              </div>
            </div>
          </div>
          {working
            ? workingRow(
                workKind === "polishing"
                  ? t("overlay.processing")
                  : t("overlay.transcribing"),
                true,
              )
            : listeningRow(open, true)}
        </div>
      </div>
    );
  }

  // ---- Minimal overlay: exactly one row at a time — waveform (recording), or a
  // spinner + label (transcribing / processing). Never both. The pill animates its
  // width between them; the cancel button is in both rows so it stays put.
  const working =
    state === "transcribing" ||
    state === "processing" ||
    state === "text_processing";
  const workLabel =
    state === "text_processing"
      ? t("overlay.transforming")
      : state === "processing"
        ? t("overlay.processing")
        : t("overlay.transcribing");

  return (
    <div
      dir={direction}
      className={`ov-stage ${position} ov-fade ${isVisible ? "show" : ""}`}
    >
      <div
        className={`scard compact ${working && isVisible ? "cworking" : ""}`}
      >
        {working ? workingRow(workLabel, true) : listeningRow(false, true)}
      </div>
    </div>
  );
};

export default RecordingOverlay;
