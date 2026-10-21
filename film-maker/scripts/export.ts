/** npm run export -- <episodeId|all> */
import { exportEpisode } from '../server/exporter';
import { loadProject } from '../server/projectFs';

const arg = process.argv[2] ?? 'all';
const { data } = loadProject();
const ids = arg === 'all' ? data.project.episodes : [arg];
for (const id of ids) {
  const r = exportEpisode(data, id);
  console.log(`✓ ${id} → ${r.dir} (${r.bundle.frame_end} frames)`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
}
console.log(`\nOpen in Blender:\n  blender --python export/<ep>/import_project.py -- export/<ep>/bundle.json`);
