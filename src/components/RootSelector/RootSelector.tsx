import "./RootSelector.css";

type RootSelectorProps = {
  rootPath: string;
  recentRoots: string[];
  onRootChange: (value: string) => void;
  onScan: () => void;
  onBrowse: () => void;
};

export default function RootSelector({
  rootPath,
  recentRoots,
  onRootChange,
  onScan,
  onBrowse,
}: RootSelectorProps) {
  return (
    <div className="controls root-selector">
      <input
        value={rootPath}
        onChange={(event) => onRootChange(event.currentTarget.value)}
        placeholder="Root folder path (e.g. /Users/me/Images)"
        list="recent-roots"
      />
      {recentRoots.length > 0 && (
        <select
          className="recent-select"
          value=""
          onChange={(event) => onRootChange(event.currentTarget.value)}
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
      <button type="button" onClick={onScan}>
        Scan
      </button>
      <button type="button" onClick={onBrowse}>
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
