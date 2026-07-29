import type { CoverageReading, CoverageState } from "@/lib/coverage";

/**
 * Coverage as a grid: 41 rows, the cumulative reading first, then one column per
 * call (R17, R18).
 *
 * CaptureGrid's layout could not be inherited wholesale. It spends both axes on
 * rubric × sub-dimension and wraps its cell strip, so there is no axis left for
 * calls and the wrapping destroys column alignment the moment call columns exist.
 * Its cell size and typography are borrowed; its structure is not.
 *
 * Nor is its colour scheme. CaptureGrid encodes score bands as colour-only CSS
 * classes, which for three states that a PM has to tell apart at a glance would
 * put the entire distinction out of reach of anyone who cannot separate the hues.
 * So each cell carries a glyph and an accessible name, and the legend spells all
 * three out in full.
 *
 * A table rather than divs, because that is what this is: rows and columns with
 * headers on both, which a screen reader can then navigate as a grid.
 */

export const STATE_LABEL: Record<CoverageState, string> = {
  "has-evidence": "has evidence",
  "evidence-rejected": "evidence rejected",
  "no-evidence": "no evidence",
};

/** One character, because a 24px cell fits one. The legend carries the meaning. */
const STATE_GLYPH: Record<CoverageState, string> = {
  "has-evidence": "●",
  "evidence-rejected": "✕",
  "no-evidence": "–",
};

function Cell({ state, rowLabel, column }: { state: CoverageState; rowLabel: string; column: string }) {
  return (
    <td
      className={`cov-cell s-${state}`}
      // Read out as "Earned insight, across all calls: has evidence" rather than
      // as a bullet character.
      aria-label={`${rowLabel}, ${column}: ${STATE_LABEL[state]}`}
    >
      <span aria-hidden="true">{STATE_GLYPH[state]}</span>
    </td>
  );
}

export function CoverageGrid({ reading }: { reading: CoverageReading }) {
  const { byRubric, callNumbers } = reading;

  return (
    <>
      <ul className="legend cov-legend" aria-label="What the marks mean">
        {(Object.keys(STATE_LABEL) as CoverageState[]).map((s) => (
          <li key={s}>
            <span className={`cov-cell s-${s}`} aria-hidden="true">
              {STATE_GLYPH[s]}
            </span>
            {STATE_LABEL[s]}
          </li>
        ))}
      </ul>

      <div className="cov-scroll">
        <table className="cov">
          <thead>
            <tr>
              <th scope="col" className="cov-rowhead">
                Sub-dimension
              </th>
              <th scope="col">Across all calls</th>
              {callNumbers.map((n) => (
                <th scope="col" key={n}>
                  Call {n}
                </th>
              ))}
            </tr>
          </thead>
          {byRubric.map((group) => (
            <tbody key={group.rubricKey}>
              <tr className="cov-group">
                <th scope="rowgroup" colSpan={2 + callNumbers.length}>
                  {group.rubricLabel}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="cov-rowhead">
                    {row.label}
                  </th>
                  <Cell state={row.state} rowLabel={row.label} column="across all calls" />
                  {row.perCall.map((state, i) => (
                    <Cell
                      key={callNumbers[i]}
                      state={state}
                      rowLabel={row.label}
                      column={`call ${callNumbers[i]}`}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
