import "./Toolbar.css";

type ToolbarProps = {
  hasImages: boolean;
  hasGroups: boolean;
  hasSelectedGroup: boolean;
  isFullscreen: boolean;
  onRandomImage: () => void;
  onRandomAny: () => void;
  onSlideshow: () => void;
  onSlideshowAny: () => void;
  onDeleteImage: () => void;
  onDeleteGroup: () => void;
  onToggleFullscreen: () => void;
};

export default function Toolbar({
  hasImages,
  hasGroups,
  hasSelectedGroup,
  isFullscreen,
  onRandomImage,
  onRandomAny,
  onSlideshow,
  onSlideshowAny,
  onDeleteImage,
  onDeleteGroup,
  onToggleFullscreen,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <div className="toolbar-actions">
        <button
          type="button"
          onClick={onRandomImage}
          disabled={!hasImages}
          title="Random image in category (R)"
        >
          Random
        </button>
        <button
          type="button"
          onClick={onRandomAny}
          disabled={!hasGroups}
          title="Random category + image (⌘R)"
        >
          Random Any
        </button>
        <button
          type="button"
          onClick={onSlideshow}
          disabled={!hasImages}
          title="Slideshow in category (S)"
        >
          Slideshow
        </button>
        <button
          type="button"
          onClick={onSlideshowAny}
          disabled={!hasGroups}
          title="Slideshow across categories (⌘S)"
        >
          Slideshow Any
        </button>
        <button
          type="button"
          onClick={onDeleteImage}
          disabled={!hasImages}
          title="Delete image (⌘D)"
        >
          Delete Image
        </button>
        <button
          type="button"
          onClick={onDeleteGroup}
          disabled={!hasSelectedGroup}
          title="Delete category (⌘⌥D)"
        >
          Delete Group
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Fullscreen (F)"
        >
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>
      <details className="shortcut-menu">
        <summary>Shortcuts</summary>
        <ul>
          <li>R — random image in category</li>
          <li>⌘R — random category + image</li>
          <li>S — slideshow in category</li>
          <li>⌘S — slideshow across categories</li>
          <li>⌘D — delete image</li>
          <li>⌘⌥D — delete category</li>
          <li>F — toggle fullscreen</li>
          <li>⌘↑ / ⌘↓ — previous/next category</li>
          <li>Enter — open selected image</li>
          <li>Esc — close viewer and stop slideshow</li>
        </ul>
      </details>
    </section>
  );
}
