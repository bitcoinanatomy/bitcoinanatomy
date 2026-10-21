import type { DialogClip, ProjectData } from './schema';

/** The TTS request for a dialog line: the speaking character's voice and tuning. */
export function ttsRequestFor(data: ProjectData, clip: Pick<DialogClip, 'text' | 'characterId'>) {
  const ch = data.characters[clip.characterId];
  return {
    text: clip.text,
    voice: ch?.voice ?? data.project.tts.defaultVoice,
    engine: data.project.tts.engine,
    tune: ch?.voiceTune,
  };
}
