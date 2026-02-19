import { convertFileSrc } from "@tauri-apps/api/core";
import { useGallery } from "../../app/GalleryContext";

export default function ImageGrid() {
  const {
    images,
    selectedImageIndex,
    imageRefs,
    setSelectedImageIndex,
    setViewerOpen,
  } = useGallery();
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
              setSelectedImageIndex(index);
              setViewerOpen(true);
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
