type ImageMetaProps = {
  date?: string | null;
  serial?: number | null;
  prompt?: string | null;
  groupId?: string | null;
  className?: string;
  maxPromptLength?: number;
};

export default function ImageMeta({
  date,
  serial,
  prompt,
  groupId,
  className,
  maxPromptLength = 640,
}: ImageMetaProps) {
  const dateText = date && date.trim() ? date : "—";
  const serialText = typeof serial === "number" ? String(serial) : "—";
  const promptText = prompt && prompt.trim() ? prompt : "—";
  const groupIdText = groupId && groupId.trim() ? groupId : "—";
  const shortPrompt =
    promptText.length > maxPromptLength
      ? `${promptText.slice(0, maxPromptLength).trim()}…`
      : promptText;

  return (
    <div className={`image-meta${className ? ` ${className}` : ""}`}>
      <div>
        <span>Serial: {serialText}</span>&nbsp;|&nbsp;
        <span>Date: {dateText}</span>
        <span className="image-meta__group">
          &nbsp;|&nbsp;Group: {groupIdText}
        </span>
      </div>
      <span className="image-meta__prompt" title={promptText}>
        Prompt: {shortPrompt}
      </span>
    </div>
  );
}
