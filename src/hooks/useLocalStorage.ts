import { useEffect, useState } from "react";

export function useLocalStorageString(key: string, defaultValue: string) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    return raw ?? defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}

export function useLocalStorageOptionalString(key: string) {
  const [value, setValue] = useState<string | null>(() => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : raw;
  });

  useEffect(() => {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export function useLocalStorageOptionalNumber(key: string) {
  const [value, setValue] = useState<number | null>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  useEffect(() => {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export function useLocalStorageJson<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

export function useLocalStorageEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T
) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw && allowed.includes(raw as T)) {
      return raw as T;
    }
    return defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}
