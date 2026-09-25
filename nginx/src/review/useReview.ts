import { useCallback, useEffect, useState } from "react";
import { apiReview, apiReviewPost, type ReviewOk, type ReviewOp } from "../shared/review-api";

export interface ReviewState {
  data: ReviewOk | null;
  error: string | null;
  refresh: () => Promise<void>;
  // Resolves to an error message, or null once the change is stored and the
  // comments are refetched.
  post: (op: ReviewOp) => Promise<string | null>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Comments for one document. `enabled` holds the first fetch until the
// document itself has loaded, so SizeGuard still gates a huge file.
export function useReview(path: string, enabled: boolean): ReviewState {
  const [data, setData] = useState<ReviewOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (isCurrent: () => boolean) =>
      apiReview(path)
        .then(r => {
          if (!isCurrent()) {
            return;
          }
          if (r.ok) {
            setData(r);
            setError(null);
          } else {
            setError(r.error);
          }
        })
        .catch(err => {
          if (isCurrent()) {
            setError(message(err));
          }
        }),
    [path],
  );

  const refresh = useCallback(() => load(() => true), [load]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [enabled, load]);

  const post = useCallback(
    async (op: ReviewOp) => {
      try {
        const r = await apiReviewPost(path, op);
        if (!r.ok) {
          return r.error;
        }
      } catch (err) {
        return message(err);
      }
      await refresh();
      return null;
    },
    [path, refresh],
  );

  return { data, error, refresh, post };
}
