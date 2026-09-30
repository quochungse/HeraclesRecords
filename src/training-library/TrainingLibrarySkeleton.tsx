import type { CSSProperties } from "react";

/*
 * The library before its snapshot lands — and, as the Suspense fallback in
 * App, before its chunk does, so opening the screen shows one loading state
 * rather than the app's spinner followed by this. That is also why
 * `trainingLibrary.css` is imported by `main.tsx`: a fallback drawn while the
 * chunk loads cannot wait on the chunk for its styles.
 *
 * The rows fill the view to its foot. A fixed seven left the lower half of a
 * tall window bare, which read as a list that had finished at seven; enough
 * rows for any window are drawn and the card clips them.
 */
const ROWS = 32;

export function TrainingLibrarySkeleton() {
  return (
    <section className="training-library-view">
      <header className="tl-masthead">
        <h1>Training Library</h1>
      </header>
      <div className="tl-skeleton" aria-label="Loading the training library">
        {Array.from({ length: ROWS }, (_, index) => (
          <span key={index} style={{ "--tl-row-index": index } as CSSProperties} />
        ))}
      </div>
    </section>
  );
}
