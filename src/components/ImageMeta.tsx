type ImageMetaProps = {
  date?: string | null;
  serial?: number | null;
  prompt?: string | null;
  className?: string;
  maxPromptLength?: number;
};

export default function ImageMeta({
  date,
  serial,
  prompt,
  className,
  maxPromptLength = 640,
}: ImageMetaProps) {
  const dateText = date && date.trim() ? date : "—";
  const serialText = typeof serial === "number" ? String(serial) : "—";
  const promptText = prompt && prompt.trim() ? prompt : "—";
  const shortPrompt =
    promptText.length > maxPromptLength
      ? `${promptText.slice(0, maxPromptLength).trim()}…`
      : promptText;

  return (
    <div className={`image-meta${className ? ` ${className}` : ""}`}>
      <div>
        <span>Serial: {serialText}</span>&nbsp;|&nbsp;
        <span>Date: {dateText}</span>
      </div>
      <span className="image-meta__prompt" title={promptText}>
        Prompt: {shortPrompt}
      </span>
    </div>
  );
}
