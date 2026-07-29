import Link from "next/link";

/**
 * Which deals the list is showing, and what it says when that is none (R7).
 *
 * The filter is two links rather than a toggle with client state, because the
 * filtering happens in the query (KTD9) — `listDeals` takes an owner and the page
 * reads it from the URL. That keeps the deals page a server component, makes a
 * filtered list shareable, and means the browser's back button does what it
 * looks like it does.
 *
 * Both halves live in one file so the param the links write stays the param the
 * page reads. They drifted apart the moment they were in two places, and a filter
 * that never turns on looks exactly like a filter with nothing to show.
 */

/** The search param the deals list reads. */
export const OWNER_PARAM = "owner";
/** Its only value. Not the user's id — the URL says whose list it is, not who. */
export const MINE = "me";

export function OwnerFilter({ mine }: { mine: boolean }) {
  return (
    <div className="seg" role="group" aria-label="Filter deals by owner">
      {/* No param at all rather than owner=all: the default view should have the
          plain URL, so /deals is the thing people share and bookmark. */}
      <Link href="/deals" aria-current={mine ? undefined : "page"}>
        All deals
      </Link>
      <Link href={`/deals?${OWNER_PARAM}=${MINE}`} aria-current={mine ? "page" : undefined}>
        Mine
      </Link>
    </div>
  );
}

/**
 * An empty list, saying which of the two reasons it is empty.
 *
 * The page had no empty branch before R7, because a blank deals list only
 * happened on the very first run. Filtering to "Mine" makes it routine — a PM who
 * has been handed nothing yet sees it on day one — and an empty page with a
 * toolbar above it reads as a page that failed to load rather than a filter
 * doing its job.
 *
 * The filtered case names the filter and offers the way out. The unfiltered case
 * does not: there is nothing to clear, and a link back to the page you are
 * already on is a dead end.
 */
export function NoDealsFound({ mine }: { mine: boolean }) {
  if (!mine) {
    return (
      <div className="empty">
        No deals yet. Open the first one at the first real call — the record starts there.
      </div>
    );
  }
  return (
    <div className="empty">
      No deals are filed under <b>Mine</b> yet. A deal is yours when you open it, or when someone
      hands it to you. <Link href="/deals">Show all deals</Link>
    </div>
  );
}
