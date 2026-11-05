#!/usr/bin/env python3
"""Set HFS+ Finder's open-folder CNID in an unmounted UDRW image.

Apple Silicon bless no longer supports --openfolder. Only Finder info word 2
is changed, not boot settings. CNID 2 is the HFS+ root directory.
See Apple's HFS+ volume header specification:
https://developer.apple.com/library/archive/technotes/tn/tn1150.html#VolumeHeader
"""
from pathlib import Path
import struct
import sys
import uuid

path = Path(sys.argv[1])
assert path.name.endswith('-readwrite.dmg'), 'Expected the temporary UDRW image'
with path.open('r+b') as image:
    image.seek(512)
    gpt = image.read(92)
    assert gpt[:8] == b'EFI PART', 'Expected a GPT image'
    table_lba, count, entry_size = struct.unpack_from('<QII', gpt, 72)
    assert 0 < count <= 4096 and 128 <= entry_size <= 4096
    hfs_guid = uuid.UUID('48465300-0000-11aa-aa11-00306543ecac').bytes_le
    offsets = []
    for i in range(count):
        image.seek(table_lba * 512 + i * entry_size)
        entry = image.read(entry_size)
        if entry[:16] != hfs_guid:
            continue
        first, last = struct.unpack_from('<QQ', entry, 32)
        for offset in (first * 512 + 1024, (last + 1) * 512 - 1024):
            image.seek(offset)
            assert image.read(2) in (b'H+', b'HX'), 'Invalid HFS+ volume header'
            offsets.append(offset + 80 + 2 * 4)
    assert len(offsets) == 2, 'Expected exactly one HFS+ partition'
    for offset in offsets:
        image.seek(offset)
        image.write(struct.pack('>I', 2))
print('Finder auto-open: root directory set in both HFS+ headers')
