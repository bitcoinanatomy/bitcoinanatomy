# Explorer sounds (Artlist)

Drop licensed Artlist exports here. The player loads **OGG first** (Quest / Firefox), then **MP3** if the browser cannot decode OGG.

Keep looping beds **1–3 minutes**, seamless, **−18 to −14 LUFS**, no vocals, no baked fade-in. SFX short and dry, peaks around **−12 dB**.

## Folders

```
sounds/scapes/   looping page beds
sounds/sfx/      one-shots
```

## Soundscapes (loops)

| File stem | Page | Artlist AI Search prompt |
|---|---|---|
| `network` | network.html | Seamless dark sci-fi ambient loop, vast orbital space, distant data pulses, sparse analog drones, cold satellite telemetry, no drums, no melody, no vocals, quiet cinematic bed for a global node map |
| `node` | node.html | Seamless server-room ambient loop, close-mic computer fans, low electrical hum, occasional distant relay clicks, enclosed machine interior, no music, no vocals, industrial but calm |
| `blockchain` | blockchain.html | Seamless deep cathedral drone loop, slow tectonic sub bass, ancient stone resonance, sparse distant chimes far in the background, timeless chain of blocks, no drums, no vocals, very slow |
| `difficulty` | difficulty.html | Seamless mining-industrial ambient loop, heat haze, distant heavy machinery, low pressure rumble, faint metronomic tick buried in the texture not as a beat, no melody, no vocals |
| `block` | block.html | Seamless crystalline sci-fi loop, glass and quartz overtones, precise geometric tones, merkle crystal interior, clean and still, no percussion, no vocals |
| `transaction` | transaction.html | Seamless liquid data-flow ambient loop, soft whooshing particles, script assembly, quiet digital stream, analog warmth, no drums, no vocals, mid-quiet |
| `address` | address.html | Seamless identity constellation ambient loop, sparse high bells very distant, key-and-lock metallic air, personal vault atmosphere, dark but intimate, no melody hook, no vocals |
| `mempool` | mempool.html | Seamless waiting-room pressure ambient loop, bubbling unconfirmed traffic, crowded digital murmur, tense but looping, no drops, no vocals, slightly busier than the other beds |

Export each as `scapes/<stem>.ogg` and `scapes/<stem>.mp3`.

Artlist: **SFX → Loops**. If search returns songs, add: `SFX loop only, not a song, no piano, no guitar`.

## SFX (one-shots)

| File stem | Artlist AI Search prompt |
|---|---|
| `ui-hover` | Very short UI hover tick, soft high click, 50 to 120 ms, dry, sci-fi glass, single hit, no reverb tail, Quest VR menu |
| `ui-select` | Short UI confirm click, slightly lower than hover, 80 to 180 ms, tactile plastic-glass, dry, one-shot, VR controller select |
| `ui-menu` | Short holographic panel open, small whoosh plus soft latch, under 400 ms, sci-fi HUD, not cartoon, dry-ish |
| `page-whoosh` | Short spatial scene transition whoosh, 400 to 800 ms, passing through a data tunnel, dark sci-fi, no boom, stereo, VR page change |

Export each as `sfx/<stem>.ogg` and `sfx/<stem>.mp3`.

## In the headset

Sound unlocks on **Enter VR** (button click) or the **first controller select**. Wrist menu **SOUND** mutes/unmutes (saved in localStorage). Desktop camera bar has a matching speaker toggle.
