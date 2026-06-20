export default function PackageLoading() {
  return (
    <div className="sx-shell">
      <div className="sx-skel-top">
        <div className="sx-skel sx-skel--brand" />
        <div className="sx-skel sx-skel--pill" />
      </div>
      <div className="sx-skel-page" aria-busy="true">
        <div className="sx-skel sx-skel--pill sx-skel--back" />
        <div className="sx-skel sx-skel--title-lg" />
        <div className="sx-skel sx-skel--par" />
        <div className="sx-skel-grid">
          <div className="sx-skel sx-skel--tile" />
          <div className="sx-skel sx-skel--tile" />
          <div className="sx-skel sx-skel--tile" />
        </div>
      </div>
    </div>
  );
}
