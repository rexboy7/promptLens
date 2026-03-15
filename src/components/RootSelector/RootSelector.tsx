import { useGallery } from "../../app/GalleryContext";
import "./RootSelector.css";

export default function RootSelector() {
  const {
    rootPath,
    recentRoots,
    handleRootChange,
    browseForRoot,
  } = useGallery();
  return (
    <div className="controls root-selector">
      <input
        value={rootPath}
        onChange={(event) => handleRootChange(event.currentTarget.value)}
        placeholder="Root folder path (e.g. C:\\Images or /home/me/images)"
        list="recent-roots"
      />
      {recentRoots.length > 0 && (
        <select
          className="recent-select"
          value=""
          onChange={(event) => handleRootChange(event.currentTarget.value)}
        >
          <option value="" disabled>
            Recent
          </option>
          {recentRoots.map((root) => (
            <option key={root} value={root}>
              {root}
            </option>
          ))}
        </select>
      )}
      <button type="button" onClick={browseForRoot}>
        Browse
      </button>
      <datalist id="recent-roots">
        {recentRoots.map((root) => (
          <option key={root} value={root} />
        ))}
      </datalist>
    </div>
  );
}
