import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from probe_tip_runtime import installed_packages, verify_cache_files


class RuntimeProbeTest(unittest.TestCase):
    def test_actual_distributions_include_extras_and_ignore_only_bootstrap_pip(self):
        rows = [SimpleNamespace(metadata={'Name': name}, version=version) for name, version in
                [('pip', '25.0'), ('faster_whisper', '1.2.1'), ('unexpected-package', '9.0')]]
        with patch('importlib.metadata.distributions', return_value=rows):
            self.assertEqual(installed_packages(), {'faster-whisper': '1.2.1', 'unexpected-package': '9.0'})
        rows.append(SimpleNamespace(metadata={'Name': 'Faster.Whisper'}, version='1.2.1'))
        with patch('importlib.metadata.distributions', return_value=rows):
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                installed_packages()

    def test_cache_bytes_are_verified_against_lfs_and_git_objects(self):
        data = {'model.bin': b'synthetic model bytes', 'config.json': b'{"synthetic":true}'}
        expected = {
            'model.bin': {'algorithm': 'sha256', 'sha': hashlib.sha256(data['model.bin']).hexdigest()},
            'config.json': {'algorithm': 'git-sha1', 'sha': hashlib.sha1(
                b'blob ' + str(len(data['config.json'])).encode() + b'\0' + data['config.json']).hexdigest()},
        }
        with TemporaryDirectory() as directory:
            for name, value in data.items():
                (Path(directory) / name).write_bytes(value)
            verify_cache_files(directory, expected)
            for name, value in data.items():
                with self.subTest(name=name):
                    (Path(directory) / name).write_bytes(value + b'changed')
                    with self.assertRaisesRegex(ValueError, 'bytes differ'):
                        verify_cache_files(directory, expected)
                    (Path(directory) / name).write_bytes(value)
            (Path(directory) / 'model.bin').unlink()
            with self.assertRaises(FileNotFoundError):
                verify_cache_files(directory, expected)

    def test_unknown_hashes_and_paths_cannot_substitute_for_pinned_files(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'model.bin'
            path.write_bytes(b'fixture')
            for name, algorithm in [('../model.bin', 'sha256'), ('model.bin', 'unknown')]:
                with self.subTest(name=name, algorithm=algorithm), self.assertRaises(ValueError):
                    verify_cache_files(directory, {name: {'algorithm': algorithm, 'sha': 'a' * 64}})


if __name__ == '__main__':
    unittest.main()
