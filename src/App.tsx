import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  Cloud,
  CloudOff,
  Command,
  Ellipsis,
  Flower2,
  Folder,
  FolderOpen,
  FolderPlus,
  Github,
  Inbox,
  Instagram,
  ListTodo,
  LoaderCircle,
  LogOut,
  Moon,
  Plus,
  Pencil,
  Search,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { auth, db, isFirebaseConfigured } from "./firebase";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: { seconds: number } | null;
  folderId: string;
};

type TaskFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

type Filter = "today" | "all" | "completed";
type Theme = "light" | "dark";
const UNSORTED_FOLDER_ID = "unsorted";
type FolderDialog =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folder: TaskFolder };

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("daylist-theme");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [folders, setFolders] = useState<TaskFolder[]>([]);
  const [filter, setFilter] = useState<Filter>("today");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [search, setSearch] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [syncState, setSyncState] = useState<"connecting" | "synced" | "offline">("connecting");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("daylist-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setSelectedFolderId(null);
      setFilter("today");
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!db || !user) {
      setTasks([]);
      setSyncState("offline");
      return;
    }
    setSyncState("connecting");
    const tasksRef = collection(db, "users", user.uid, "tasks");
    const tasksQuery = query(tasksRef, orderBy("createdAt", "desc"));
    return onSnapshot(
      tasksQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        setSyncState(snapshot.metadata.fromCache ? "offline" : "synced");
        setTasks(snapshot.docs.map((taskDoc) => ({
          id: taskDoc.id,
          title: taskDoc.data().title as string,
          completed: taskDoc.data().completed as boolean,
          createdAt: taskDoc.data().createdAt,
          folderId: (taskDoc.data().folderId as string | undefined) ?? UNSORTED_FOLDER_ID,
        })));
        setTaskError("");
      },
      (error) => {
        setSyncState("offline");
        setTaskError(`Couldn't sync your tasks: ${error.message}`);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!db || !user) {
      setFolders([]);
      return;
    }
    const foldersQuery = query(
      collection(db, "users", user.uid, "folders"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(
      foldersQuery,
      (snapshot) => {
        setFolders(snapshot.docs.map((folderDoc) => ({
          id: folderDoc.id,
          name: folderDoc.data().name as string,
          parentId: (folderDoc.data().parentId as string | undefined) ?? null,
        })));
      },
      (error) => setTaskError(`Couldn't sync your folders: ${error.message}`),
    );
  }, [user]);

  const activeFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderPath = activeFolder ? getFolderPath(activeFolder, folders) : [];
  const scopedTasks = selectedFolderId
    ? tasks.filter((task) => task.folderId === selectedFolderId)
    : tasks;
  const visibleTasks = useMemo(() => {
    const filtered = scopedTasks.filter((task) => {
      if (filter === "today") return !task.completed;
      if (filter === "completed") return task.completed;
      return true;
    });
    if (!search.trim()) return filtered;
    return filtered.filter((task) => task.title.toLowerCase().includes(search.trim().toLowerCase()));
  }, [filter, search, scopedTasks]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const remainingCount = tasks.length - completedCount;
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);
  const scopedCompletedCount = scopedTasks.filter((task) => task.completed).length;

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setAuthError("");
    try {
      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user || !newTask.trim()) return;
    setSavingTask(true);
    setTaskError("");
    try {
      await addDoc(collection(db, "users", user.uid, "tasks"), {
        title: newTask.trim(),
        completed: false,
        folderId: selectedFolderId ?? UNSORTED_FOLDER_ID,
        createdAt: serverTimestamp(),
      });
      setNewTask("");
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't add task: ${error.message}` : "Couldn't add task.");
    } finally {
      setSavingTask(false);
    }
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!db || !user || !name || folderDialog?.mode !== "create") return;
    setSavingFolder(true);
    setTaskError("");
    try {
      const folderRef = await addDoc(collection(db, "users", user.uid, "folders"), {
        name,
        parentId: folderDialog.parentId,
        createdAt: serverTimestamp(),
      });
      setSelectedFolderId(folderRef.id);
      setFilter("all");
      setNewFolderName("");
      setFolderDialog(null);
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't create folder: ${error.message}` : "Couldn't create folder.");
    } finally {
      setSavingFolder(false);
    }
  }

  async function renameFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!db || !user || !name || folderDialog?.mode !== "rename") return;
    setSavingFolder(true);
    setTaskError("");
    try {
      await updateDoc(doc(db, "users", user.uid, "folders", folderDialog.folder.id), { name });
      setNewFolderName("");
      setFolderDialog(null);
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't rename folder: ${error.message}` : "Couldn't rename folder.");
    } finally {
      setSavingFolder(false);
    }
  }

  async function removeFolder(folder: TaskFolder) {
    if (!db || !user) return;
    const descendants = getDescendantFolders(folder, folders);
    const foldersToDelete = [folder, ...descendants];
    const folderIdsToDelete = new Set(foldersToDelete.map((item) => item.id));
    const tasksToDelete = tasks.filter((task) => folderIdsToDelete.has(task.folderId));
    const confirmed = window.confirm(
      `Permanently delete "${folder.name}" and everything inside it? This will delete ${foldersToDelete.length} ${foldersToDelete.length === 1 ? "folder" : "folders"} and ${tasksToDelete.length} ${tasksToDelete.length === 1 ? "task" : "tasks"}. This cannot be undone.`,
    );
    if (!confirmed) return;

    const firestore = db;
    const userId = user.uid;
    const isSelectedFolderBeingDeleted = selectedFolderId !== null && folderIdsToDelete.has(selectedFolderId);
    const itemsToDelete = [
      ...tasksToDelete.map((task) => doc(firestore, "users", userId, "tasks", task.id)),
      ...foldersToDelete.map((item) => doc(firestore, "users", userId, "folders", item.id)),
    ];

    try {
      for (let index = 0; index < itemsToDelete.length; index += 450) {
        const batch = writeBatch(firestore);
        for (const item of itemsToDelete.slice(index, index + 450)) batch.delete(item);
        await batch.commit();
      }
      if (isSelectedFolderBeingDeleted) {
        setSelectedFolderId(folder.parentId);
        setFilter("all");
      }
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error
        ? `Couldn't completely delete the folder tree. Some items may already have been deleted; refresh before retrying. ${error.message}`
        : "Couldn't completely delete the folder tree. Some items may already have been deleted; refresh before retrying.");
    }
  }

  async function toggleTask(task: Task) {
    if (!db || !user) return;
    try {
      await updateDoc(doc(db, "users", user.uid, "tasks", task.id), { completed: !task.completed });
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't update task: ${error.message}` : "Couldn't update task.");
    }
  }

  async function removeTask(task: Task) {
    if (!db || !user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "tasks", task.id));
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't delete task: ${error.message}` : "Couldn't delete task.");
    }
  }

  async function saveTaskEdit(task: Task) {
    if (!db || !user || !editDraft.trim()) return;
    try {
      await updateDoc(doc(db, "users", user.uid, "tasks", task.id), { title: editDraft.trim() });
      setEditingTaskId(null);
      setEditDraft("");
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't update task: ${error.message}` : "Couldn't update task.");
    }
  }

  async function clearCompleted() {
    if (!db || !user) return;
    if (!window.confirm(`Delete ${scopedCompletedCount} completed ${scopedCompletedCount === 1 ? "task" : "tasks"}?`)) return;
    const firestore = db;
    const userId = user.uid;
    const completedTasks = scopedTasks.filter((task) => task.completed);
    try {
      await Promise.all(completedTasks.map((task) => deleteDoc(doc(firestore, "users", userId, "tasks", task.id))));
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error ? `Couldn't clear completed tasks: ${error.message}` : "Couldn't clear completed tasks.");
    }
  }

  async function handleSignOut() {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Couldn't sign out.");
    }
  }

  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  if (!isFirebaseConfigured) return <SetupScreen theme={theme} onToggleTheme={toggleTheme} />;
  if (!authReady) {
    return <div className="loading-screen"><LoaderCircle size={24} className="spin" /><span>Getting things ready…</span></div>;
  }
  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        theme={theme}
        email={email}
        password={password}
        error={authError}
        busy={busy}
        onModeChange={(mode) => { setAuthMode(mode); setAuthError(""); }}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleAuth}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const displayName = user.displayName || user.email?.split("@")[0] || "friend";
  const greeting = getGreeting();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Daylist home">
          <span className="brand-mark"><Flower2 size={20} strokeWidth={2.5} /></span>
          <span>daylist<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-switcher">
          <div className="workspace-avatar">D</div>
          <span className="workspace-name">My workspace</span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">YOUR SPACE</div>
        <nav className="nav-list" aria-label="Task filters">
          <button className={`nav-item ${!selectedFolderId && filter === "today" ? "active" : ""}`} onClick={() => { setSelectedFolderId(null); setFilter("today"); }}>
            <Sun size={17} /><span>Today</span><span className="nav-count">{remainingCount}</span>
          </button>
          <button className={`nav-item ${!selectedFolderId && filter === "all" ? "active" : ""}`} onClick={() => { setSelectedFolderId(null); setFilter("all"); }}>
            <Inbox size={17} /><span>All tasks</span><span className="nav-count">{tasks.length}</span>
          </button>
          <button className={`nav-item ${!selectedFolderId && filter === "completed" ? "active" : ""}`} onClick={() => { setSelectedFolderId(null); setFilter("completed"); }}>
            <CheckCircle2 size={17} /><span>Completed</span>{completedCount > 0 && <span className="nav-count">{completedCount}</span>}
          </button>
        </nav>
        <div className="folder-section">
          <div className="folder-section-heading">
            <span className="nav-label">FOLDERS</span>
            <button className="folder-add-button" onClick={() => { setNewFolderName(""); setFolderDialog({ mode: "create", parentId: null }); }} aria-label="Create top-level folder" title="Create top-level folder"><Plus size={15} /></button>
          </div>
          <div className="folder-list">
            {tasks.some((task) => task.folderId === UNSORTED_FOLDER_ID) && (
              <button
                className={`nav-item folder-nav-item ${selectedFolderId === UNSORTED_FOLDER_ID ? "active" : ""}`}
                onClick={() => { setSelectedFolderId(UNSORTED_FOLDER_ID); setFilter("all"); }}
              >
                <Folder size={16} /><span>Unsorted</span><span className="nav-count">{tasks.filter((task) => task.folderId === UNSORTED_FOLDER_ID).length}</span>
              </button>
            )}
            {folderTree.map(({ folder, depth }) => (
              <div className="folder-row" key={folder.id} style={{ paddingLeft: `${depth * 14}px` }}>
                <button
                  className={`nav-item folder-nav-item ${selectedFolderId === folder.id ? "active" : ""}`}
                  onClick={() => { setSelectedFolderId(folder.id); setFilter("all"); }}
                  title={folder.name}
                >
                  {selectedFolderId === folder.id ? <FolderOpen size={16} /> : <Folder size={16} />}
                  <span>{folder.name}</span>
                  <span className="nav-count">{tasks.filter((task) => task.folderId === folder.id).length}</span>
                </button>
                <div className="folder-row-actions">
                  <button
                    className="folder-row-action"
                    onClick={() => { setNewFolderName(""); setFolderDialog({ mode: "create", parentId: folder.id }); }}
                    aria-label={`Create subfolder in ${folder.name}`}
                    title={`Create subfolder in ${folder.name}`}
                  ><FolderPlus size={14} /></button>
                  <button
                    className="folder-row-action"
                    onClick={() => { setNewFolderName(folder.name); setFolderDialog({ mode: "rename", folder }); }}
                    aria-label={`Rename ${folder.name}`}
                    title={`Rename ${folder.name}`}
                  ><Pencil size={13} /></button>
                  <button
                    className="folder-row-action folder-delete-action"
                    onClick={() => void removeFolder(folder)}
                    aria-label={`Delete ${folder.name}`}
                    title={`Delete ${folder.name}`}
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {folders.length === 0 && !tasks.some((task) => task.folderId === UNSORTED_FOLDER_ID) && (
              <p className="folder-empty-hint">Create folders for your subjects and projects.</p>
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="weekly-card">
            <div className="weekly-icon"><Sparkles size={16} /></div>
            <div className="weekly-title">Little by little</div>
            <p>You’ve completed <strong>{completedCount} {completedCount === 1 ? "task" : "tasks"}</strong>. Keep your momentum going!</p>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="progress-caption"><span>Daily progress</span><strong>{progress}%</strong></div>
          </div>
          <div className="sidebar-divider" />
          <button className="profile-button" onClick={handleSignOut}>
            <div className="user-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
            <div className="profile-copy"><strong>{displayName}</strong><span>{user.email}</span></div>
            <LogOut size={16} className="logout-icon" />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>My workspace</span>
            {folderPath.length > 0 ? folderPath.map((folder) => (
              <span className="breadcrumb-folder" key={folder.id}><span className="breadcrumb-slash">/</span><strong>{folder.name}</strong></span>
            )) : <><span className="breadcrumb-slash">/</span><strong>{selectedFolderId === UNSORTED_FOLDER_ID ? "Unsorted" : filterTitle(filter)}</strong></>}
          </div>
          <div className="topbar-right">
            <div className={`sync-status sync-${syncState}`}><span className="sync-dot" /><span>{syncState === "connecting" ? "Connecting" : syncState === "synced" ? "Synced" : "Offline"}</span></div>
            <span className="topbar-divider" />
            <button
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "night" : "day"} mode`}
              title={`Switch to ${theme === "light" ? "night" : "day"} mode`}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button className="topbar-avatar" aria-label={`Signed in as ${displayName}`}>{displayName.slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <div className="date-label"><span className="date-spark">✳</span> {todayLabel()}</div>
              <h1>{greeting}, {displayName}<span className="wave">✦</span></h1>
              <p className="welcome-subtitle">A little progress each day adds up to big results.</p>
            </div>
            <div className="date-illustration" aria-hidden="true">
              <div className="sun-glow" /><div className="sun-circle" /><div className="hill hill-back" /><div className="hill hill-front" />
              <span className="tiny-star star-one">✳</span><span className="tiny-star star-two">✦</span>
            </div>
          </section>

          <div className="section-heading">
            <div className="section-title-group">
              <div className="section-icon">{activeFolder || selectedFolderId === UNSORTED_FOLDER_ID ? <FolderOpen size={17} /> : <ListTodo size={17} />}</div>
              <h2>{activeFolder?.name ?? (selectedFolderId === UNSORTED_FOLDER_ID ? "Unsorted" : filterTitle(filter))}</h2>
              <span className="task-total">{visibleTasks.length}</span>
            </div>
            <div className="list-actions">
              <label className={`search-box ${search ? "searching" : ""}`}>
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
                {search && <button type="button" className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={13} /></button>}
              </label>
              <button className="sort-button" title="Tasks are sorted by most recently added"><ArrowDown size={14} /> <span>Recent</span></button>
              <button className="more-button" aria-label="More task options" onClick={() => void clearCompleted()} disabled={scopedCompletedCount === 0} title="Clear completed tasks"><Ellipsis size={19} /></button>
            </div>
          </div>

          {taskError && <div className="inline-error" role="alert"><CloudOff size={16} /><span>{taskError}</span></div>}

          <form className="add-task-form" onSubmit={addTask}>
            <div className="add-plus"><Plus size={19} /></div>
            <input
              aria-label="Add a task"
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              placeholder={`Add a task${activeFolder ? ` to ${activeFolder.name}` : selectedFolderId === UNSORTED_FOLDER_ID ? " to Unsorted" : " to Unsorted"}...`}
              maxLength={240}
            />
            {newTask.trim() && <button className="add-submit" type="submit" disabled={savingTask}>{savingTask ? <LoaderCircle size={16} className="spin" /> : "Add task"}<ArrowRight size={15} /></button>}
            {!newTask.trim() && <span className="enter-hint">↵</span>}
          </form>

          <div className="task-list" aria-live="polite">
            {visibleTasks.length > 0 ? visibleTasks.map((task) => (
              <article key={task.id} className={`task-row ${task.completed ? "task-completed" : ""}`}>
                <button className="task-check" onClick={() => void toggleTask(task)} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}>
                  {task.completed ? <span className="checked-circle"><Check size={13} strokeWidth={3} /></span> : <Circle size={19} strokeWidth={1.7} />}
                </button>
                {editingTaskId === task.id ? (
                  <input
                    className="task-edit-input"
                    aria-label={`Edit ${task.title}`}
                    value={editDraft}
                    maxLength={240}
                    autoFocus
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveTaskEdit(task);
                      if (event.key === "Escape") { setEditingTaskId(null); setEditDraft(""); }
                    }}
                  />
                ) : <span className="task-title">{task.title}</span>}
                <span className="task-date">{task.createdAt ? formatTaskDate(task.createdAt.seconds) : "Just now"}</span>
                {editingTaskId === task.id ? (
                  <button className="task-edit-save" aria-label="Save task" onClick={() => void saveTaskEdit(task)}><Check size={15} /></button>
                ) : (
                  <button className="task-edit" aria-label={`Edit ${task.title}`} onClick={() => { setEditingTaskId(task.id); setEditDraft(task.title); }}><Pencil size={14} /></button>
                )}
                <button className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => void removeTask(task)}><Trash2 size={15} /></button>
              </article>
            )) : (
              <div className="empty-state">
                <div className="empty-icon">{search ? <Search size={22} /> : filter === "completed" ? <CheckCheck size={23} /> : <Flower2 size={23} />}</div>
                <h3>{search ? "No matching tasks" : filter === "completed" ? "Nothing completed just yet" : filter === "today" && scopedTasks.length > 0 ? "You’re all caught up!" : selectedFolderId ? "This folder is empty" : "A fresh start"}</h3>
                <p>{search ? "Try another search or clear the filter." : filter === "completed" ? "When you finish a task, it’ll find a home here." : filter === "today" && scopedTasks.length > 0 ? "Take a breath. You’ve made room for what matters." : selectedFolderId ? "Add a task above to keep everything in this folder together." : "Add a task above or create a folder to get organized."}</p>
                {search && <button className="text-button" onClick={() => setSearch("")}>Clear search</button>}
              </div>
            )}
          </div>

          <footer className="list-footer">
            <span><Cloud size={14} /> Changes sync automatically</span>
            <span className="footer-tip"><Command size={12} /> <span>{theme === "light" ? "Day mode" : "Night mode"}</span></span>
          </footer>
        </div>
        <footer className="copyright-footer">
          <span>&copy; {new Date().getFullYear()} Govind Rathod. All rights reserved.</span>
          <a href="https://www.instagram.com/govindxrd/" target="_blank" rel="noreferrer" aria-label="Instagram profile">
            <Instagram size={14} /> Instagram
          </a>
          <a href="https://github.com/govindrd" target="_blank" rel="noreferrer" aria-label="GitHub profile">
            <Github size={14} /> GitHub
          </a>
        </footer>
      </main>
      {folderDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFolderDialog(null);
        }}>
          <form className="folder-dialog" onSubmit={(event) => void (folderDialog.mode === "create" ? createFolder(event) : renameFolder(event))}>
            <button type="button" className="dialog-close" onClick={() => setFolderDialog(null)} aria-label="Close"><X size={17} /></button>
            <div className="dialog-folder-icon"><Folder size={20} /></div>
            <h2>{folderDialog.mode === "create" ? "Create a folder" : "Rename folder"}</h2>
            <p>{folderDialog.mode === "create"
              ? folderDialog.parentId
                ? `Create a folder inside ${folders.find((folder) => folder.id === folderDialog.parentId)?.name ?? "the selected folder"}.`
                : "Organize tasks by subject, project, or anything that helps."
              : `Choose a new name for ${folderDialog.folder.name}.`}</p>
            <label htmlFor="folder-name">Folder name</label>
            <input
              id="folder-name"
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="e.g. Biology, Work, Personal"
              maxLength={40}
              required
            />
            <div className="dialog-actions">
              <button type="button" className="dialog-cancel" onClick={() => setFolderDialog(null)}>Cancel</button>
              <button type="submit" className="dialog-create" disabled={savingFolder || !newFolderName.trim()}>
                {savingFolder ? <LoaderCircle size={15} className="spin" /> : folderDialog.mode === "create" ? <Plus size={15} /> : <Check size={15} />}
                {folderDialog.mode === "create" ? "Create folder" : "Save name"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function AuthScreen({
  mode, theme, email, password, error, busy, onModeChange, onEmailChange, onPasswordChange, onSubmit, onToggleTheme,
}: {
  mode: "signin" | "signup";
  theme: Theme;
  email: string;
  password: string;
  error: string;
  busy: boolean;
  onModeChange: (mode: "signin" | "signup") => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleTheme: () => void;
}) {
  return (
    <div className="auth-screen">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="standalone-theme-toggle" />
      <div className="auth-decoration auth-decoration-one" /><div className="auth-decoration auth-decoration-two" />
      <div className="auth-card">
        <a className="brand auth-brand" href="#"><span className="brand-mark"><Flower2 size={20} strokeWidth={2.5} /></span><span>daylist<span className="brand-period">.</span></span></a>
        <div className="auth-eyebrow">A calmer way to get things done</div>
        <h1>{mode === "signin" ? "Welcome back." : "Make room for more."}</h1>
        <p className="auth-description">{mode === "signin" ? "Sign in to pick up right where you left off." : "Create an account and start your own little list."}</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="you@example.com" />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="At least 6 characters" />
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : mode === "signin" ? "Sign in" : "Create account"}{!busy && <ArrowRight size={16} />}</button>
        </form>
        <p className="auth-switch">{mode === "signin" ? "New to Daylist?" : "Already have an account?"} <button onClick={() => onModeChange(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Create an account" : "Sign in"}</button></p>
        <div className="auth-footnote"><Cloud size={14} /> Your tasks stay in sync across all your devices.</div>
      </div>
      <div className="auth-quote"><span>“</span>Small steps every day add up.<span className="quote-star">✳</span></div>
    </div>
  );
}

function SetupScreen({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <div className="setup-screen">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="standalone-theme-toggle" />
      <div className="setup-card">
        <a className="brand auth-brand" href="#"><span className="brand-mark"><Flower2 size={20} strokeWidth={2.5} /></span><span>daylist<span className="brand-period">.</span></span></a>
        <div className="setup-icon"><CloudOff size={23} /></div>
        <h1>One little setup first.</h1>
        <p>Connect a Firebase project to start syncing your tasks across devices.</p>
        <ol>
          <li>Create a Firebase project and enable <strong>Email/Password</strong> sign-in and <strong>Cloud Firestore</strong>.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and add your Firebase web app configuration.</li>
          <li>Deploy the included Firestore security rules, then restart the dev server.</li>
        </ol>
        <div className="setup-note">See <code>README.md</code> for the full setup guide.</div>
      </div>
    </div>
  );
}

function ThemeToggle({ theme, onToggle, className = "" }: { theme: Theme; onToggle: () => void; className?: string }) {
  const nextMode = theme === "light" ? "night" : "day";
  return (
    <button
      className={`icon-button theme-toggle ${className}`}
      onClick={onToggle}
      aria-label={`Switch to ${nextMode} mode`}
      title={`Switch to ${nextMode} mode`}
    >
      {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function formatTaskDate(seconds: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(seconds * 1000));
}

function filterTitle(filter: Filter) {
  if (filter === "completed") return "Completed";
  if (filter === "all") return "All tasks";
  return "Today";
}

function buildFolderTree(folders: TaskFolder[]) {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const childrenByParent = new Map<string | null, TaskFolder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  }

  const result: { folder: TaskFolder; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      result.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };

  visit(null, 0);
  for (const folder of folders) {
    if (!visited.has(folder.id)) {
      visited.add(folder.id);
      result.push({ folder, depth: 0 });
      visit(folder.id, 1);
    }
  }
  return result;
}

function getFolderPath(folder: TaskFolder, folders: TaskFolder[]) {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const path: TaskFolder[] = [];
  const visited = new Set<string>();
  let current: TaskFolder | undefined = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function getDescendantFolders(folder: TaskFolder, folders: TaskFolder[]) {
  const childrenByParent = new Map<string, TaskFolder[]>();
  for (const item of folders) {
    if (!item.parentId) continue;
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }

  const descendants: TaskFolder[] = [];
  const visited = new Set<string>([folder.id]);
  const visit = (parentId: string) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(child);
      visit(child.id);
    }
  };
  visit(folder.id);
  return descendants;
}

export default App;
