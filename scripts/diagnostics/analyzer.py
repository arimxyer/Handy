"""Image proxies for card loss. These proxies do not prove display flicker."""
import numpy as np


class CardAnalyzer:
    def __init__(self, baseline):
        rgb = baseline[:, :, :3].astype(np.int16)
        eligible = (baseline[:, :, 3] > 100) & (rgb.mean(axis=2) > 8)
        quantized = rgb // 8
        colors, counts = np.unique(quantized[eligible], axis=0, return_counts=True)
        if not len(colors):
            raise ValueError('No card pixels in the baseline')
        self.color = colors[counts.argmax()] * 8 + 4
        self.mask = eligible & (np.abs(rgb - self.color).max(axis=2) < 12)
        ys, xs = np.where(self.mask)
        self.bounds = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        x0, y0, x1, y1 = self.bounds
        self.text_region = np.zeros(eligible.shape, dtype=bool)
        self.text_region[y0:max(y0 + 1, y1 - round(40 * baseline.shape[1] / 400)), x0:x1] = True
        self.ink_reference = self.ink_count(baseline)

    def ink_count(self, frame):
        rgb = frame[:, :, :3].astype(np.int16)
        contrast = np.abs(rgb - self.color).mean(axis=2) > 40
        unsaturated = rgb.max(axis=2) - rgb.min(axis=2) < 35
        return int((self.text_region & contrast & unsaturated & (frame[:, :, 3] > 100)).sum())

    def measure(self, frame):
        rgb = frame[:, :, :3].astype(np.int16)
        changed = (np.abs(rgb - self.color).max(axis=2) > 24) | (frame[:, :, 3] < 16)
        red_dot = (rgb[:, :, 2] > rgb[:, :, 1] + 25) & (rgb[:, :, 2] > rgb[:, :, 0] + 25)
        return {'card_loss_ratio': float(changed[self.mask].mean()),
                'text_ink_pixels': self.ink_count(frame),
                'text_ink_ratio': self.ink_count(frame) / max(1, self.ink_reference),
                'accent_pixels': int((red_dot & (frame[:, :, 3] > 100)).sum()),
                'baseline_card_pixels': int(self.mask.sum()),
                'baseline_bounds': self.bounds}


def selftest():
    baseline = np.zeros((200, 400, 4), dtype=np.uint8)
    baseline[80:195, 4:396] = [32, 32, 32, 250]
    baseline[100:105, 20:250] = [220, 220, 220, 255]
    baseline[160:167, 20:27] = [100, 80, 225, 255]
    analyzer = CardAnalyzer(baseline)
    clean = analyzer.measure(baseline)
    erased = np.zeros_like(baseline)
    erased[160:167, 20:27] = baseline[160:167, 20:27]
    failed = analyzer.measure(erased)
    assert clean['card_loss_ratio'] == 0
    assert clean['text_ink_ratio'] == 1
    assert failed['card_loss_ratio'] > .95
    assert failed['text_ink_ratio'] == 0
    assert failed['accent_pixels'] == clean['accent_pixels'] > 0
    print({'fixture': 'erased card, retained accent dot', 'baseline': clean, 'erased': failed})

if __name__ == '__main__':
    selftest()
