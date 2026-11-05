#!/usr/bin/env python3
"""Write Finder layout directly so packaging needs no Apple Events permission."""
from pathlib import Path
import sys
from ds_store import DSStore
from mac_alias import Alias

mount = Path(sys.argv[1]).resolve()
background = mount / '.background' / 'installer.png'
with DSStore.open(str(mount / '.DS_Store'), 'w+') as store:
    store['.']['vSrn'] = ('long', 1)
    store['.']['icvl'] = ('type', b'icnv')
    store['.']['vstl'] = ('type', b'icnv')
    store['.']['bwsp'] = {
        'WindowBounds': '{{200, 160}, {720, 512}}',
        'ShowStatusBar': False, 'ShowToolbar': False, 'ShowPathbar': False,
        'ShowSidebar': False, 'ContainerShowSidebar': False,
        'ShowTabView': False, 'PreviewPaneVisibility': False, 'SidebarWidth': 0,
    }
    store['.']['icvp'] = {
        'viewOptionsVersion': 1, 'backgroundType': 2,
        'backgroundColorRed': 1.0, 'backgroundColorGreen': 1.0, 'backgroundColorBlue': 1.0,
        'backgroundImageAlias': Alias.for_file(str(background)).to_bytes(),
        'gridOffsetX': 0.0, 'gridOffsetY': 0.0, 'gridSpacing': 100.0,
        'arrangeBy': 'none', 'showIconPreview': True, 'showItemInfo': False,
        'labelOnBottom': True, 'textSize': 13.0, 'iconSize': 104.0,
        'scrollPositionX': 0.0, 'scrollPositionY': 0.0,
    }
    store['TranscribeThem.app']['Iloc'] = (244, 340)
    store['Applications']['Iloc'] = (476, 340)
