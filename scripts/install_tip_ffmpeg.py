"""Install and verify the locked encoder. Only hosted runners override Ubuntu's archive mirror."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ARCHIVE = 'https://archive.ubuntu.com/ubuntu'
MIRROR = re.compile(r'(?:mirror\+file:/+etc/apt/apt-mirrors\.txt|https?://[a-z0-9.-]+\.ec2\.archive\.ubuntu\.com/ubuntu)/?')
SUITES = {'noble', 'noble-updates', 'noble-backports', 'noble-proposed'}
AUDIT_PACKAGES = ('tesseract-ocr', 'tesseract-ocr-fra')
APT_RETRY_DELAYS_SECONDS = (1, 4)


def archive_url(url):
    return ARCHIVE if MIRROR.fullmatch(url) else url


def archive_sources(text, deb822):
    if deb822:
        chunks = re.split(r'(\n[ \t]*\n)', text)
        for index in range(0, len(chunks), 2):
            stanza = chunks[index]
            suites = re.search(r'^Suites:[ \t]*(.*(?:\n[ \t]+[^\n]*)*)', stanza, re.M | re.I)
            if suites and suites[1].split() and set(suites[1].split()) <= SUITES:
                chunks[index] = re.sub(r'^(URIs:[ \t]*)([^\n]*(?:\n[ \t]+[^\n]*)*)',
                                       lambda m: m[1] + re.sub(r'\S+', lambda u: archive_url(u[0]), m[2]),
                                       stanza, flags=re.M | re.I)
        return ''.join(chunks)
    entry = r'^([ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\n]+\][ \t]+)?)(\S+)([ \t]+)(\S+)'
    return re.sub(entry, lambda m: m[1] + (archive_url(m[2]) if m[4] in SUITES else m[2]) + m[3] + m[4],
                  text, flags=re.M)


def apt_command(hosted, apt, temp):
    options = []
    if hosted:
        dest = Path(temp)
        parts = dest / 'sources.list.d'
        parts.mkdir(mode=0o700)
        main = apt / 'sources.list'
        for src in [main, *(apt / 'sources.list.d').glob('*.sources'), *(apt / 'sources.list.d').glob('*.list')]:
            target = dest / src.relative_to(apt)
            target.write_text(archive_sources(src.read_text(), src.suffix == '.sources') if src.exists() else '')
            target.chmod(0o600)
        options = ['-o', f'Dir::Etc::sourcelist={dest / "sources.list"}',
                   '-o', f'Dir::Etc::sourceparts={parts}']
    return ['sudo', '-n', 'apt-get', *options]


def run_apt_bounded(command, arguments, run=None, sleep=None):
    run = run or subprocess.run
    sleep = sleep or time.sleep
    invocation = [*command, *arguments]
    for attempt in range(len(APT_RETRY_DELAYS_SECONDS) + 1):
        result = run(invocation, check=False)
        if result.returncode == 0:
            return
        if attempt == len(APT_RETRY_DELAYS_SECONDS):
            raise subprocess.CalledProcessError(result.returncode, invocation)
        sleep(APT_RETRY_DELAYS_SECONDS[attempt])


def install_audit_tools(hosted, apt=Path('/etc/apt'), run=None, sleep=None):
    """Install only the official Ubuntu OCR packages needed by the final audit."""
    with tempfile.TemporaryDirectory() as temp:
        command = apt_command(hosted, apt, temp)
        run_apt_bounded(command, ['update', '-qq'], run, sleep)
        run_apt_bounded(command, ['install', '-y', '--no-install-recommends', *AUDIT_PACKAGES], run, sleep)


def install(lock, version, hosted, apt=Path('/etc/apt')):
    expected = lock['ffmpegPackage']
    if version != expected:
        with tempfile.TemporaryDirectory() as temp:
            cmd = apt_command(hosted, apt, temp)
            subprocess.run([*cmd, 'update', '-qq'], check=True)
            subprocess.run([*cmd, 'install', '-y', '--no-install-recommends', f'ffmpeg={expected}'], check=True)
    for name in ('ffmpeg', 'ffprobe'):
        if hashlib.sha256(Path(shutil.which(name)).read_bytes()).hexdigest() != lock[name + 'Sha256']:
            raise ValueError(f'{name} does not match runtime lock')


if __name__ == '__main__':
    arguments = sys.argv[1:]
    hosted = os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    if arguments == ['--audit-tools']:
        install_audit_tools(hosted)
        raise SystemExit(0)
    if arguments:
        raise SystemExit('Usage: install_tip_ffmpeg.py [--audit-tools]')
    pins = json.loads(Path(__file__).with_name('tip-runtime-lock.json').read_text())
    current = subprocess.run(['dpkg-query', '-W', '-f=${Version}', 'ffmpeg'], capture_output=True, text=True)
    install(pins, current.stdout if current.returncode == 0 else '', hosted)
