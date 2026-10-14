/** Placeholder filling for the global intro/outro credits. */
import type { Episode, ProjectData } from './schema';

export interface CreditVars {
  project: string;
  season: string;
  episode?: Pick<Episode, 'number' | 'title' | 'theme'>;
}

export const creditVars = (data: ProjectData, episodeId?: string): CreditVars => ({
  project: data.project.title,
  season: data.project.season.title,
  episode: episodeId ? data.episodes[episodeId] : undefined,
});

/** Fill {project} {season} {episode.number} {episode.title} {episode.theme} */
export function fillCredit(text: string, v: CreditVars) {
  return text
    .replaceAll('{project}', v.project)
    .replaceAll('{season}', v.season)
    .replaceAll('{episode.number}', v.episode ? String(v.episode.number) : '#')
    .replaceAll('{episode.title}', v.episode?.title ?? 'Episode title')
    .replaceAll('{episode.theme}', v.episode?.theme ?? '');
}
