import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from audit_tip_v11 import audit
from audit_tip_v11_brand_cta import (
    CONTRACT, FRAME_PLAN, HEIGHT, MASK, OCR_TARGETS, SHORTS_BRAND_BOUNDS, SHORTS_BRAND_MASK, SHORTS_OCR_TARGETS,
    WIDTH, check_tsv, decode_frames, inside, logo_check, measure_final_brand_cta, sample_plan, text_check,
)


def tsv(words):
    header = 'level\tleft\ttop\twidth\theight\tconf\ttext\n'
    return (header + ''.join(f'5\t{x}\t{y}\t{width}\t{height}\t{confidence}\t{text}\n'
                           for x, y, width, height, confidence, text in words)).encode()


def fixture_alignment():
    return json.loads((Path(__file__).parent / 'fixtures' / 'tip-v11-brand-cta-smoke.json').read_text())


class BrandCtaEvidenceTest(unittest.TestCase):
    def test_shorts_keeps_all_ocr_targets_inside_its_own_brand_mask(self):
        self.assertTrue(all(inside(bounds, SHORTS_BRAND_BOUNDS) for bounds, _, _ in SHORTS_OCR_TARGETS.values()))
        with patch('audit_tip_v11_brand_cta.decode_frames', side_effect=ValueError('fixture')):
            result = measure_final_brand_cta('fixture.mp4', fixture_alignment(), Path('unread.png'), 'fra', shorts=True)
        self.assertEqual((result['mask'], result['mask_bounds'], result['status']),
                         (SHORTS_BRAND_MASK, SHORTS_BRAND_BOUNDS, 'inconclusive'))

    def test_samples_only_the_fixed_intro_and_fully_visible_outro_windows(self):
        alignment = fixture_alignment()
        plan = sample_plan(alignment)
        self.assertEqual([label for label, _ in plan], [label for label, _, _ in FRAME_PLAN])
        self.assertEqual([frame for _, frame in plan], [11, 66, 66, 90, 107, 138, 162, 162])
        alignment['segments'].append({'id': 'assistant', 'start': 1., 'end': 2.})
        self.assertIsNone(sample_plan(alignment))
        self.assertEqual(measure_final_brand_cta('unread.mp4', alignment, Path('unread.png'), 'fra')['reason'],
                         'unsupported_assistant_outro')

    def test_exact_ocr_returns_real_source_coordinates_and_preserves_the_plus_and_last_digit(self):
        bounds, _, expected = OCR_TARGETS['phone']
        recognized = [(8, 12, 35, 38, 93.1, '+221'), (52, 12, 40, 38, 92., '76 944 48 49')]
        passed, box, metric = check_tsv('phone', bounds, expected, tsv(recognized))
        self.assertTrue(passed)
        self.assertEqual(box, (136, 918, 220, 956))
        self.assertEqual(metric['expected_sha256'], metric['observed_sha256'])
        self.assertEqual(metric['min_confidence_milli'], 92000)
        self.assertFalse(check_tsv('phone', bounds, expected, tsv(recognized[:-1] + [
            (52, 12, 40, 38, 98., '76 944 48 48')]))[0])
        self.assertFalse(check_tsv('phone', bounds, expected, tsv([(8, 12, 35, 38, 94., '221'), recognized[1]]))[0])
        self.assertFalse(check_tsv('phone', bounds, expected, tsv([(8, 12, 35, 38, 20., '+221'), recognized[1]]))[0])
        with self.assertRaisesRegex(ValueError, 'outside input crop'):
            check_tsv('phone', bounds, expected, tsv([(-1, 12, 35, 38, 98., '+221')]))
        self.assertFalse(check_tsv('phone', (0, 898, 110, 972), expected, tsv(recognized))[0])

    def test_domain_uses_luminance_and_keeps_exact_punctuation_confidence_and_geometry(self):
        bounds, psm, _ = OCR_TARGETS['domain']
        left, top, right, bottom = bounds
        count = (right - left) * (bottom - top)
        rgb = bytes((255, 240, 220, 255, 180, 107)) * (count // 2)
        with patch('audit_tip_v11_brand_cta.crop', return_value=rgb) as take_crop, \
             patch('audit_tip_v11_brand_cta.run') as run_ocr:
            run_ocr.return_value = tsv([(3, 14, 517, 66, 83.65, 'jammimmo.com')])
            passed, box, metric = text_check(None, 'domain', 'fra')
            self.assertTrue(passed)
            self.assertEqual(box, (left + 3, top + 14, left + 520, top + 80))
            self.assertEqual(metric['expected_sha256'], metric['observed_sha256'])
            self.assertEqual(metric['min_confidence_milli'], 83650)
            take_crop.assert_called_once_with(None, bounds)
            self.assertEqual(run_ocr.call_args.args, ('tesseract', ['stdin', 'stdout', '-l', 'fra', '--psm', str(psm), 'tsv']))
            header = f'P5\n{right - left} {bottom - top}\n255\n'.encode()
            self.assertEqual(run_ocr.call_args.kwargs['data'], header + bytes((242, 194)) * (count // 2))
            for observed, confidence in [('jammimmo.com.', 98.), ('jammimmo.net', 98.), ('jammimmo.com', 59.9)]:
                with self.subTest(observed=observed, confidence=confidence):
                    run_ocr.return_value = tsv([(3, 14, 517, 66, confidence, observed)])
                    self.assertFalse(text_check(None, 'domain', 'fra')[0])

    def test_color_pattern_reveals_a_partially_covered_logo(self):
        pixels = bytearray(WIDTH * HEIGHT * 3)
        samples = [(x, y, 210, 110, 10, bucket) for bucket in range(8)
                   for x in range((bucket % 4) * 44 + 3, (bucket % 4) * 44 + 12)
                   for y in [5 + (bucket // 4) * 39]]
        for x, y, red, green, blue, _ in samples:
            offset = ((263 + y) * WIDTH + 137 + x) * 3
            pixels[offset:offset + 3] = bytes((red, green, blue))
        self.assertTrue(logo_check(pixels, samples, (2, 3, 174, 76))[0])
        for x, y, _, _, _, bucket in samples:
            if bucket == 0:
                offset = ((263 + y) * WIDTH + 137 + x) * 3
                pixels[offset:offset + 3] = bytes(3)
        passed, _, metrics = logo_check(pixels, samples, (2, 3, 174, 76))
        self.assertFalse(passed)
        self.assertEqual(metrics['kind'], 'alpha_rgb_mae')
        self.assertGreater(metrics['worst_tile_error_milli'], metrics['mean_error_milli'])

    def test_ffmpeg_receives_exact_frames_and_incomplete_output_stays_inconclusive(self):
        with patch('audit_tip_v11_brand_cta.run', return_value=b'bad') as command:
            with self.assertRaisesRegex(ValueError, 'do not match'):
                decode_frames('fixture.mp4', [99, 7, 7])
            args = command.call_args.args[1]
            self.assertEqual(args[args.index('-vf') + 1], r'select=eq(n\,7)+eq(n\,99)')
            self.assertIn('passthrough', args)
        with patch('audit_tip_v11_brand_cta.decode_frames', side_effect=ValueError('fixture')):
            result = measure_final_brand_cta('fixture.mp4', fixture_alignment(), Path('unread.png'), 'fra')
        self.assertEqual((result['contract'], result['mask'], result['status']), (CONTRACT, MASK, 'inconclusive'))
        self.assertEqual(result['checks'], [])

    def test_visibility_measures_the_same_hashed_mp4_snapshot(self):
        alignment = fixture_alignment() | {'provenance': 'synthetic'}
        args = SimpleNamespace(alignment='align', narration_wav='voice', mix_wav='mix', video='source.mp4',
                               render_manifest=None, ocr_language='fra', measure_final_french=False, brand_logo=Path('logo.png'))
        proof = {'status': 'inconclusive'}
        with patch('audit_tip_v11.limited_read', return_value=b'fake alignment'), \
             patch('audit_tip_v11.verify_alignment', return_value=alignment), \
             patch('audit_tip_v11.read_wave', return_value=(b'other', 'reference sha')), \
             patch('audit_tip_v11.snapshot_video', return_value=('mp4 sha', 20)) as snapshot, \
             patch('audit_tip_v11.media_shape', return_value={'passed': True}), \
             patch('audit_tip_v11.command', return_value=bytes(12)), \
             patch('audit_tip_v11.measure_audio', return_value={'passed': True}), \
             patch('audit_tip_v11.measure_text', return_value={'passed': True}), \
             patch('audit_tip_v11.measure_final_brand_cta', return_value=proof) as measure:
            report = audit(args)
        self.assertTrue(report['passed'])
        self.assertEqual(report['final_brand_cta_visibility'], proof)
        measure.assert_called_once_with(snapshot.call_args.args[1], alignment, Path('logo.png'), 'fra')


if __name__ == '__main__':
    unittest.main()
