import { useEffect, useMemo, useState } from "react";

type MenuState<Id> = {
  id: Id;
  x: number;
  y: number;
};

type Options = {
  width?: number;
  height?: number;
  padding?: number;
};

export function useContextMenu<Id>(options: Options = {}) {
  const [menu, setMenu] = useState<MenuState<Id> | null>(null);
  const menuId = useMemo(() => menu?.id ?? null, [menu]);
  const menuPosition = useMemo(
    () => (menu ? { x: menu.x, y: menu.y } : null),
    [menu]
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const openMenu = (event: MouseEvent, id: Id) => {
    event.preventDefault();
    const width = options.width ?? 180;
    const height = options.height ?? 164;
    const padding = options.padding ?? 8;
    const x = Math.min(event.clientX, window.innerWidth - width - padding);
    const y = Math.min(event.clientY, window.innerHeight - height - padding);
    setMenu({ id, x, y });
  };

  const closeMenu = () => setMenu(null);

  return {
    menuId,
    menuPosition,
    openMenu,
    closeMenu,
    isOpen: menu !== null,
  };
}
