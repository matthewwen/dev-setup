import { useState } from "react";
import { apiList, type Entry, type TreeLevel } from "./api";

interface TreeNodeProps {
  path: string;
  name: string;
  expanded: Set<string>;
  childrenByPath: Map<string, Entry[]>;
  currentPath: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onPrefetch: (path: string) => void;
}

function TreeNode({ path, name, expanded, childrenByPath, currentPath, onToggle, onOpen, onPrefetch }: TreeNodeProps) {
  const isOpen = expanded.has(path);
  const kids = childrenByPath.get(path);
  return (
    <div className="tnode">
      <div
        className={path === currentPath ? "trow here" : "trow"}
        onClick={() => onOpen(path)}
        onPointerOver={() => onPrefetch(path)}
      >
        <span
          className="tw"
          onClick={e => {
            e.stopPropagation();
            onToggle(path);
          }}
        >
          {isOpen ? "▾" : "▸"}
        </span>
        <span className="tname">{name}</span>
      </div>
      {isOpen && (
        <div className="tkids">
          {(kids ?? []).map(k => (
            <TreeNode
              key={k.path}
              path={`/${k.path}`}
              name={k.name}
              expanded={expanded}
              childrenByPath={childrenByPath}
              currentPath={currentPath}
              onToggle={onToggle}
              onOpen={onOpen}
              onPrefetch={onPrefetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// The lazy sidebar. `levels` (the dirs-only ancestor chain from the current
// listing) seeds the ancestor chain expanded; every other node lazy-loads
// its children on first expand and keeps them cached for the session.
export function Tree({
  currentPath,
  levels,
  hidden,
  onOpen,
  onPrefetch,
}: {
  currentPath: string;
  levels: TreeLevel[] | undefined;
  hidden: boolean;
  onOpen: (path: string) => void;
  onPrefetch: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [childrenByPath, setChildrenByPath] = useState<Map<string, Entry[]>>(new Map());
  const [seededFrom, setSeededFrom] = useState<TreeLevel[] | undefined>(undefined);

  // Each navigation brings a new ancestor chain. Seed it and expand it in this
  // render, so the old expansion never paints.
  if (levels !== seededFrom) {
    setSeededFrom(levels);
    if (levels && levels.length) {
      const next = new Map(childrenByPath);
      levels.forEach(level => next.set(level.path, level.entries));
      setChildrenByPath(next);
      setExpanded(new Set(levels.map(level => level.path)));
    }
  }

  const toggle = async (path: string) => {
    if (expanded.has(path)) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    if (!childrenByPath.has(path)) {
      const data = await apiList(path);
      const kids = data.ok ? data.entries.filter(e => e.type === "dir") : [];
      setChildrenByPath(prev => new Map(prev).set(path, kids));
    }
    setExpanded(prev => new Set(prev).add(path));
  };

  return (
    <nav id="tree" className={hidden ? "hidden" : ""}>
      <TreeNode
        path="/"
        name="📁 webroot"
        expanded={expanded}
        childrenByPath={childrenByPath}
        currentPath={currentPath}
        onToggle={toggle}
        onOpen={onOpen}
        onPrefetch={onPrefetch}
      />
    </nav>
  );
}
