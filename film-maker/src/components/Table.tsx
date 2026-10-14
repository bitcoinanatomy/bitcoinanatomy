import { useState, type ReactNode } from 'react';

export interface Col<T> {
  key: string;
  label: string;
  render: (row: T, index: number) => ReactNode;
  sort?: (row: T) => string | number;
  width?: number | string;
  className?: string;
}

/** Sortable table. Rows keep their natural (story) order until a header is clicked. */
export function Table<T>({ rows, cols, rowKey }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = sort && cols.find((c) => c.key === sort.key);
  const indexed = rows.map((r, i) => ({ r, i }));
  if (col?.sort) {
    const f = col.sort;
    indexed.sort((a, b) => {
      const x = f(a.r);
      const y = f(b.r);
      return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir;
    });
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ width: c.width }} onClick={() => c.sort && setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {indexed.map(({ r, i }) => (
            <tr key={rowKey(r)}>
              {cols.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
