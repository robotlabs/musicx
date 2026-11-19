import { describe, expect, it } from 'vitest'
import { matchItunes, parseItunes } from './itunes'
import { buildLibrary } from './library'
import type { RawMeta } from './pcloud'

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Major Version</key><integer>1</integer>
	<key>Show Content Ratings</key><true/>
	<key>Tracks</key>
	<dict>
		<key>1</key>
		<dict>
			<key>Track ID</key><integer>1</integer>
			<key>Name</key><string>Blu Notte</string>
			<key>Artist</key><string>Paolo Conte</string>
			<key>Size</key><integer>4713923</integer>
			<key>Location</key><string>file://localhost/Users/roberto/Music/-musica-/paolo%20conte/paolo%20conte%20-%20blu%20notte.mp3</string>
		</dict>
		<key>2</key>
		<dict>
			<key>Track ID</key><integer>2</integer>
			<key>Name</key><string>Love Letters</string>
			<key>Artist</key><string>Ketty Lester</string>
			<key>Size</key><integer>777</integer>
			<key>Location</key><string>file://localhost/Users/roberto/Music/x/Ketty%20Lester%20-%20Love%20Letters.mp3</string>
		</dict>
		<key>3</key>
		<dict>
			<key>Track ID</key><integer>3</integer>
			<key>Name</key><string>Rock &amp; Roll</string>
			<key>Artist</key><string>Led Zeppelin</string>
			<key>Size</key><integer>1</integer>
			<key>Location</key><string>file://localhost/Users/roberto/Music/altrove/rock.mp3</string>
		</dict>
		<key>4</key>
		<dict>
			<key>Track ID</key><integer>4</integer>
			<key>Name</key><string>i bambini dell'asilo</string>
			<key>Artist</key><string>Vasco Rossi</string>
			<key>Size</key><integer>2</integer>
		</dict>
	</dict>
	<key>Playlists</key>
	<array>
		<dict>
			<key>Name</key><string>Libreria</string>
			<key>Master</key><true/>
			<key>Playlist Items</key>
			<array><dict><key>Track ID</key><integer>1</integer></dict></array>
		</dict>
		<dict>
			<key>Name</key><string>-ABSOLUTE_</string>
			<key>Playlist Items</key>
			<array>
				<dict><key>Track ID</key><integer>2</integer></dict>
				<dict><key>Track ID</key><integer>1</integer></dict>
				<dict><key>Track ID</key><integer>3</integer></dict>
				<dict><key>Track ID</key><integer>4</integer></dict>
				<dict><key>Track ID</key><integer>1</integer></dict>
			</array>
		</dict>
	</array>
</dict>
</plist>`

const song = (fileid: number, name: string, extra: Partial<RawMeta> = {}): RawMeta => ({ name, isfolder: false, fileid, ...extra })
const library = buildLibrary({
  name: 'music',
  isfolder: true,
  folderid: 1,
  contents: [
    {
      name: '[italianGoldMusic]',
      isfolder: true,
      folderid: 2,
      contents: [
        song(10, 'paolo conte - blu notte.mp3', { size: 4713923 }),
        song(11, 'Ketty Lester - Love Letters.mp3', { size: 777 }),
        song(12, 'The Commitments - Dark End.mp3', { size: 777 }),
      ],
    },
    { name: 'Led Zeppelin', isfolder: true, folderid: 3, contents: [song(30, '04 Rock and Roll.mp3', { artist: 'Led Zeppelin', title: 'Rock & Roll', size: 5 })] },
  ],
})

describe('playlist di iTunes', () => {
  it('legge nome e brani in ordine, senza le playlist di sistema', () => {
    const lists = parseItunes(xml)
    expect(lists.map((list) => list.name)).toEqual(['-ABSOLUTE_'])
    expect(lists[0].tracks.map((track) => track.name)).toEqual(['Love Letters', 'Blu Notte', 'Rock & Roll', "i bambini dell'asilo", 'Blu Notte'])
    expect(lists[0].tracks[1]).toMatchObject({ artist: 'Paolo Conte', size: 4713923 })
  })

  it('ritrova i brani: dimensione (a parità il nome), poi artista e titolo; senza doppioni', () => {
    const { trackIds, missing } = matchItunes(library, parseItunes(xml)[0].tracks)
    expect(trackIds).toEqual([11, 10, 30])
    expect(missing).toEqual(["Vasco Rossi — i bambini dell'asilo"])
  })
})
