import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DbGroup, DbItem } from "../../db";
import * as db from "../../db";

type DbRecord = DbItem | DbGroup;

type DbItemPickerProps = {
  allowSave: boolean;
  hideImportExport?: boolean;
  index: number;
  value: unknown;
  storeName: string;
  onLoadItem: (value: unknown) => void;
};

function itemPath(item: DbRecord) {
  return [item.name0, item.name1, item.name2, item.name3]
    .filter(Boolean)
    .join("/");
}

function itemDepth(item: DbRecord) {
  return [item.name0, item.name1, item.name2, item.name3].filter(Boolean)
    .length;
}

function makeRecord(path: string, isGroup: 0, value: unknown): DbItem;
function makeRecord(path: string, isGroup: 1, value?: unknown): DbGroup;
function makeRecord(path: string, isGroup: 0 | 1, value?: unknown) {
  const parts = path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    name0: parts[0] ?? "",
    name1: parts[1] ?? "",
    name2: parts[2] ?? "",
    name3: parts[3] ?? "",
    isGroup,
    ...(isGroup ? {} : { value }),
  };
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DbItemPicker({
  allowSave,
  hideImportExport = false,
  index,
  value,
  storeName,
  onLoadItem,
}: DbItemPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [records, setRecords] = useState<DbRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState("");

  const sortedRecords = useMemo(
    () =>
      [...records].sort((a, b) => {
        const pathCompare = itemPath(a).localeCompare(itemPath(b));
        if (pathCompare !== 0) return pathCompare;
        return b.isGroup - a.isGroup;
      }),
    [records]
  );

  const selectedRecord = useMemo(
    () => records.find((item) => itemPath(item) === selectedPath),
    [records, selectedPath]
  );

  const refresh = useCallback(async () => {
    setRecords(await db.getArray(storeName));
  }, [storeName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fail = (message: string) => {
    setError(message);
    return false;
  };

  const addOrOverwriteItem = async () => {
    const path = (nameInput || selectedPath).trim();
    if (!path) return fail("Name is required.");

    const item = makeRecord(path, 0, value);
    const ok =
      (await db.addItem(storeName, item)) ||
      (await db.overwriteItem(storeName, item));
    if (!ok) return fail("Could not save item.");

    setError("");
    setSelectedPath(path);
    await refresh();
    return true;
  };

  const addGroup = async () => {
    const path = nameInput.trim();
    if (!path) return fail("Group name is required.");

    const ok = await db.addGroup(storeName, makeRecord(path, 1));
    if (!ok) return fail("Could not add group.");

    setError("");
    setSelectedPath(path);
    await refresh();
    return true;
  };

  const renameSelected = async () => {
    if (!selectedRecord) return fail("Select an item first.");
    const newName = nameInput.trim().split("/").filter(Boolean).pop();
    if (!newName) return fail("New name is required.");

    const ok = await db.renameItem(storeName, selectedRecord, newName);
    if (!ok) return fail("Could not rename item.");

    setError("");
    setSelectedPath("");
    await refresh();
    return true;
  };

  const deleteSelected = async () => {
    if (!selectedRecord) return fail("Select an item first.");

    const ok = await db.deleteItem(storeName, selectedRecord);
    if (!ok) return fail("Could not delete item.");

    setError("");
    setSelectedPath("");
    await refresh();
    return true;
  };

  const loadSelected = () => {
    if (!selectedRecord || selectedRecord.isGroup) {
      fail("Select a saved item first.");
      return;
    }
    setError("");
    onLoadItem(selectedRecord.value);
  };

  const exportJson = () => {
    downloadJson(`${storeName}.json`, records);
  };

  const importJson = async (file: File | null) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as DbRecord[];
      if (!Array.isArray(data)) {
        fail("Invalid JSON file.");
        return;
      }
      const ok = await db.bulkAdd(storeName, data);
      if (!ok) {
        fail("Could not import JSON.");
        return;
      }
      setError("");
      await refresh();
    } catch {
      fail("Could not parse JSON.");
    }
  };

  return (
    <div className="text-sm">
      <div className="mb-2 font-semibold">
        {storeName === "ranges" ? "Saved Ranges" : "Saved Configurations"}
      </div>

      <div className="max-h-72 overflow-y-auto rounded border border-gray-300 bg-white">
        {sortedRecords.length === 0 ? (
          <div className="px-3 py-2 text-gray-500">No saved items</div>
        ) : (
          sortedRecords.map((item) => {
            const path = itemPath(item);
            const depth = itemDepth(item);
            const selected = selectedPath === path;
            return (
              <button
                className={[
                  "block w-full truncate px-3 py-1.5 text-left",
                  selected ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100",
                  item.isGroup ? "font-semibold" : "",
                ].join(" ")}
                key={`${path}-${item.isGroup}`}
                onClick={() => {
                  setSelectedPath(path);
                  setNameInput(path);
                }}
                style={{ paddingLeft: `${0.75 + Math.max(depth - 1, 0)}rem` }}
                type="button"
              >
                {item.isGroup ? "> " : ""}
                {path.split("/").pop()}
              </button>
            );
          })
        )}
      </div>

      <input
        className="mt-3 w-full rounded-lg px-2 py-1 text-sm"
        onChange={(event) => setNameInput(event.target.value)}
        placeholder={`Name ${index + 1}`}
        type="text"
        value={nameInput}
      />

      {error && <div className="mt-2 font-semibold text-red-500">{error}</div>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="button-base button-blue"
          disabled={!selectedRecord || selectedRecord.isGroup === 1}
          onClick={loadSelected}
          type="button"
        >
          Load
        </button>
        <button
          className="button-base button-green"
          disabled={!allowSave}
          onClick={addOrOverwriteItem}
          type="button"
        >
          Save
        </button>
        <button
          className="button-base button-blue"
          onClick={addGroup}
          type="button"
        >
          Add Group
        </button>
        <button
          className="button-base button-blue"
          disabled={!selectedRecord}
          onClick={renameSelected}
          type="button"
        >
          Rename
        </button>
        <button
          className="button-base button-red"
          disabled={!selectedRecord}
          onClick={deleteSelected}
          type="button"
        >
          Delete
        </button>
      </div>

      {!hideImportExport && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            accept="application/json,.json"
            className="hidden"
            onChange={(event) =>
              importJson(event.currentTarget.files?.[0] ?? null)
            }
            ref={inputRef}
            type="file"
          />
          <button
            className="button-base button-blue"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            Import
          </button>
          <button
            className="button-base button-blue"
            onClick={exportJson}
            type="button"
          >
            Export
          </button>
        </div>
      )}
    </div>
  );
}
