import { createContext, useContext } from "react";
import { useGalleryController } from "./useGalleryController";

export function useGallery() {
  const context = useContext(GalleryContext);
  if (!context) {
    throw new Error("useGallery must be used within GalleryProvider");
  }
  return context;
}

const GalleryContext = createContext<ReturnType<typeof useGalleryController> | null>(
  null
);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
  const controller = useGalleryController();
  return <GalleryContext.Provider value={controller}>{children}</GalleryContext.Provider>;
}
