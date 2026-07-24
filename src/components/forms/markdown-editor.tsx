import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = {
  value: string;
  className?: string;
  onChange: (value: string) => void;
  onReady?: (editor: Crepe | null) => void;
};

export function MarkdownEditor({ value, className, onChange, onReady }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let alive = true;
    root.replaceChildren();
    const editor = new Crepe({
      root,
      defaultValue: initialValueRef.current,
      features: {
        [Crepe.Feature.TopBar]: true
      }
    });

    editor.on((listener) => {
      listener.markdownUpdated((_, markdown) => onChangeRef.current(markdown));
    });
    void editor.create().then(() => {
      if (alive) {
        onReadyRef.current?.(editor);
      }
    });

    return () => {
      alive = false;
      onReadyRef.current?.(null);
      void editor.destroy();
    };
  }, []);

  return <div ref={rootRef} className={cn("taskasaur-markdown-editor min-h-[360px] w-full bg-background", className)} />;
}
