import { useEffect, useRef } from "react";
import { createFeedback, type FeedbackOptions, type FeedbackWidget } from "../widget";

export type FeedbackProps = FeedbackOptions;

export function Feedback(props: FeedbackProps): null {
  const widget = useRef<FeedbackWidget | null>(null);
  const shown = useRef<FeedbackProps>(props);

  // Effects run only in the browser, so a server render never touches the DOM.
  useEffect(() => {
    const created = createFeedback(shown.current);
    widget.current = created;
    return () => {
      created.destroy();
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    const before = shown.current;
    if (!widget.current || before === props) return;
    const keys = new Set([...Object.keys(before), ...Object.keys(props)]) as Set<
      keyof FeedbackProps
    >;
    if ([...keys].every((key) => Object.is(before[key], props[key]))) return;
    // A prop that is gone goes back to its default.
    const next: Parameters<FeedbackWidget["update"]>[0] = { ...props };
    for (const key of keys) if (!(key in props)) next[key] = undefined;
    widget.current.update(next);
    shown.current = props;
  });

  return null;
}
