import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageItem } from "../../data/types";

type ImageGridProps = {
  images: ImageItem[];
  selectedImageIndex: number | null;
  imageRefs: React.MutableRefObject<Record<number, HTMLButtonElement | null>>;
  onSelectImage: (index: number) => void;
  onOpenViewer: () => void;
};

export default function ImageGrid({
  images,
  selectedImageIndex,
  imageRefs,
  onSelectImage,
  onOpenViewer,
}: ImageGridProps) {
  return (
    <section className="image-grid">
      {images.map((image, index) => {
        const src = convertFileSrc(image.path);
        return (
          <button
            key={`${image.path}-${image.serial}`}
            type="button"
            className={index === selectedImageIndex ? "image active" : "image"}
            ref={(node) => {
              imageRefs.current[index] = node;
            }}
            onClick={() => {
              onSelectImage(index);
              onOpenViewer();
            }}
          >
            <img src={src} alt={`${image.serial}-${image.seed}`} />
            <span className="image-caption">
              {image.serial}-{image.seed}
            </span>
          </button>
        );
      })}
      {images.length === 0 && (
        <div className="empty">Select a group to view images.</div>
      )}
    </section>
  );
}
