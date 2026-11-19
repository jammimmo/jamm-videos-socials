import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from install_tip_ffmpeg import ARCHIVE, archive_sources, install

MIRROR_URL = 'mirror+file:/etc/apt/apt-mirrors.txt'


class ArchiveTests(unittest.TestCase):
    def test_deb822_keeps_security_suites_signatures_and_others(self):
        source = (f'Types: deb\nURIs: {MIRROR_URL}\nSuites: noble noble-updates\nComponents: main\n'
                  f'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: {MIRROR_URL}\n'
                  'Suites: noble-security\nComponents: main\n')
        self.assertEqual(archive_sources(source, True), source.replace(MIRROR_URL, ARCHIVE, 1))
        mixed = source.replace('noble noble-updates', 'noble noble-security')
        self.assertEqual(archive_sources(mixed, True), mixed)

    def test_legacy_changes_only_known_archive_urls_and_suites(self):
        url = 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu'
        line = f'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] {url} noble main\n'
        other = line.replace('noble main', 'noble-security main') + line.replace(url, 'https://example.org/ubuntu')
        self.assertEqual(archive_sources(line + other, False), line.replace(url, ARCHIVE) + other)

    def test_update_and_exact_install_share_ephemeral_sources_and_check_both_binaries(self):
        with TemporaryDirectory() as dirname:
            apt = Path(dirname)
            (apt / 'sources.list.d').mkdir()
            source = apt / 'sources.list.d/ubuntu.sources'
            original = f'Types: deb\nURIs: {MIRROR_URL}\nSuites: noble\n'
            source.write_text(original)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            lock = {'ffmpegPackage': 'pinned', 'ffmpegSha256': digest, 'ffprobeSha256': digest}
            calls = []
            def run(args, check):
                calls.append(args)
                parts = Path(next(a.split('=', 1)[1] for a in args if a.startswith('Dir::Etc::sourceparts=')))
                self.assertEqual((parts / 'ubuntu.sources').read_text(), original.replace(MIRROR_URL, ARCHIVE))
            with patch('install_tip_ffmpeg.subprocess.run', side_effect=run), patch('install_tip_ffmpeg.shutil.which', return_value=str(source)):
                install(lock, 'old', True, apt)
                self.assertEqual(calls[0][:-2], calls[1][:-4])
                self.assertEqual(calls[1][-1], 'ffmpeg=pinned')
                self.assertEqual(source.read_text(), original)
                with self.assertRaises(ValueError):
                    install({**lock, 'ffprobeSha256': '0'*64}, 'pinned', True, apt)
                self.assertEqual(len(calls), 2)
