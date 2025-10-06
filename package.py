#!/usr/bin/env python3
"""Build helper for packaging the Electron + Python desktop application."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent
SERVER_DIR = ROOT / "server"
ELECTRON_DIR = ROOT / "electron"
BUILD_DIR = ROOT / "build"
PYINSTALLER_BUILD_DIR = BUILD_DIR / "pyinstaller-build"
PYINSTALLER_DIST_DIR = BUILD_DIR / "pyinstaller-dist"
HOOKS_DIR = BUILD_DIR / "pyinstaller-hooks"

# Directories that must be copied alongside the Electron bundle so that runtime
# path lookups continue to work after packaging.
EXTRA_RESOURCE_MAPPINGS: List[Tuple[str, str]] = [
    ("python_backend", "python_backend"),
    (str((ROOT / "meta").resolve()), "meta"),
    (str((ROOT / "data").resolve()), "data"),
    ("static", "static"),
    ("dist/assets", "dist/assets"),
]

# Python packages that require bundled data files or hidden imports when the
# backend is frozen via PyInstaller.
PYINSTALLER_PACKAGE_TARGETS: List[str] = [
    "doclayout_yolo",
    "magic_pdf",
    "FlagEmbedding",
    "sentence_transformers",
    "bm25s",
    "huggingface_hub",
    "fast_langdetect",
    "transformers.models.metaclip",
    "transformers.models.metaclip_2",
]


class PackagingError(RuntimeError):
    """Raised when a required build step fails."""


def run_command(command: Sequence[str], *, cwd: Optional[Path] = None, env: Optional[Dict[str, str]] = None) -> None:
    """Execute a command and surface failures immediately."""

    working_dir = str(cwd) if cwd else os.getcwd()
    command_display = " ".join(command)
    print(f"\n>> {command_display}\n   cwd: {working_dir}")

    environment = os.environ.copy()
    if env:
        environment.update(env)

    try:
        subprocess.run(command, cwd=cwd, env=environment, check=True)
    except subprocess.CalledProcessError as exc:  # pragma: no cover - interactive script
        raise PackagingError(f"command failed with exit code {exc.returncode}: {command_display}") from exc


def validate_project_structure() -> None:
    """Ensure that the expected project directories are present."""

    missing: List[str] = []
    for path in (SERVER_DIR, ELECTRON_DIR):
        if not path.exists():
            missing.append(str(path))

    if missing:
        joined = ", ".join(missing)
        raise PackagingError(f"missing required project directories: {joined}")


def install_python_dependencies(skip: bool) -> None:
    """Install backend dependencies so PyInstaller can import everything."""

    if skip:
        print("Skipping python dependency installation at user request.")
        return

    requirements_path = SERVER_DIR / "requirements.txt"
    if not requirements_path.exists():
        raise PackagingError(f"Python requirements file not found: {requirements_path}")

    run_command([sys.executable, "-m", "pip", "install", "--upgrade", "pip"])
    run_command([sys.executable, "-m", "pip", "install", "-r", str(requirements_path)])

    # Ensure the build tooling and specialised dependencies are available.
    build_extras = ["pyinstaller", "pyinstaller-hooks-contrib", "timm"]
    run_command([sys.executable, "-m", "pip", "install", *build_extras])

    # doclayout-yolo is distributed with a hyphen in the package name.
    try:
        run_command([sys.executable, "-m", "pip", "install", "doclayout-yolo"])
    except PackagingError:
        print("warning: failed to install doclayout-yolo automatically; ensure it is available in the current environment.")


def create_runtime_hook() -> Path:
    """Generate a PyInstaller runtime hook to align resource paths at runtime."""

    HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    hook_path = HOOKS_DIR / "set_project_root.py"

    hook_contents = f"""from __future__ import annotations

import os
import sys
from pathlib import Path


def _configure() -> None:
    # Resolve the app's resource directory inside the frozen bundle.
    executable_path = Path(sys.executable).resolve()
    bundle_root = executable_path.parent
    # The Electron bundle expects shared resources at the directory that holds
    # python_backend, meta, and data.
    resources_root = bundle_root.parent
    os.environ.setdefault("FS_APP_RESOURCES_ROOT", str(resources_root))

    def _path_from_env(name: str, fallback: Path) -> Path:
        value = os.environ.get(name)
        if not value:
            return fallback
        candidate = Path(value).expanduser()
        try:
            return candidate.resolve()
        except Exception:
            return fallback

    external_root = _path_from_env("FS_APP_EXTERNAL_ROOT", resources_root)
    data_root = _path_from_env("FS_APP_DATA_DIR", external_root / "data")
    meta_root = _path_from_env("FS_APP_META_DIR", external_root / "meta")

    os.environ.setdefault("FS_APP_EXTERNAL_ROOT", str(external_root))
    os.environ.setdefault("FS_APP_DATA_DIR", str(data_root))
    os.environ.setdefault("FS_APP_META_DIR", str(meta_root))

    for target in (external_root, data_root, meta_root):
        target.mkdir(parents=True, exist_ok=True)

    try:
        from config import config as config_module
    except Exception:  # pragma: no cover - defensive during packaging
        return

    # Rebase server configuration paths so they reference the shared resources
    # directory rather than the PyInstaller temporary extraction directory.
    config_module.ServerConfig.PROJECT_ROOT = external_root
    config_module.ServerConfig.BGE_M3_MODEL_PATH = meta_root / "embedding" / "bge-m3"
    config_module.ServerConfig.BGE_RERANKER_MODEL_PATH = meta_root / "reranker" / "bge-reranker-v3-m3"

    config_module.DatabaseConfig.PROJECT_ROOT = external_root
    config_module.DatabaseConfig.DATABASE_DIR = data_root
    config_module.DatabaseConfig.SQLITE_DIR = meta_root / "sqlite"
    config_module.DatabaseConfig.VECTOR_DIR = meta_root / "vector"
    config_module.DatabaseConfig.IMAGES_DIR = meta_root / "images"
    config_module.DatabaseConfig.SQLITE_DB_PATH = config_module.DatabaseConfig.SQLITE_DIR / "documents.db"
    config_module.DatabaseConfig.VECTOR_INDEX_PATH = config_module.DatabaseConfig.VECTOR_DIR / "vector_index.faiss"
    config_module.DatabaseConfig.VECTOR_METADATA_PATH = config_module.DatabaseConfig.VECTOR_DIR / "vector_metadata.json"
    config_module.DatabaseConfig.IMAGE_VECTOR_INDEX_PATH = config_module.DatabaseConfig.VECTOR_DIR / "image_vector_index.faiss"
    config_module.DatabaseConfig.IMAGE_VECTOR_METADATA_PATH = config_module.DatabaseConfig.VECTOR_DIR / "image_vector_metadata.json"
    config_module.DatabaseConfig.ensure_directories()

    try:
        from config import mineru_config as mineru_module
    except Exception:
        return

    mineru_module.PROJECT_ROOT = external_root
    mineru_module.META_ROOT = meta_root / "pdf-extract-kit"
    mineru_module.META_ROOT.mkdir(parents=True, exist_ok=True)
    mineru_module.MODELS_DIR = mineru_module.META_ROOT / "models"
    mineru_module.LAYOUTREADER_DIR = mineru_module.MODELS_DIR / "ReadingOrder" / "layout_reader"
    if hasattr(mineru_module, "MINERU_CONFIG"):
        mineru_module.MINERU_CONFIG["models-dir"] = str(mineru_module.MODELS_DIR)
        mineru_module.MINERU_CONFIG["layoutreader-model-dir"] = str(mineru_module.LAYOUTREADER_DIR)


_configure()
"""

    hook_path.write_text(hook_contents, encoding="utf-8")
    return hook_path


def create_spec_file(runtime_hook: Path) -> Path:
    """Create a PyInstaller spec tailored to the backend requirements."""

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    spec_path = BUILD_DIR / "python_backend.spec"

    packages_literal = ", ".join(f"'{pkg}'" for pkg in PYINSTALLER_PACKAGE_TARGETS)
    hiddenimports_literal = "\n    ".join([
        "'uvicorn.logging',",
        "'uvicorn.protocols.http',",
        "'uvicorn.protocols.http.auto',",
        "'uvicorn.protocols.websockets',",
        "'uvicorn.protocols.websockets.auto',",
        "'uvicorn.lifespan',",
        "'uvicorn.lifespan.on',",
        "'uvicorn.lifespan.off',",
        "'transformers.models.metaclip',",
        "'transformers.models.metaclip_2',",
    ])

    spec_contents = f"""# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

project_root = Path(r"{ROOT}")
server_dir = project_root / "server"

hiddenimports = [
    {hiddenimports_literal}
]

datas = []


def _extend_hiddenimports(package: str) -> None:
    try:
        hiddenimports.extend(collect_submodules(package))
    except Exception as error:  # pragma: no cover - packaging-time guard
        print(f"[package.py] warning: failed to collect submodules for {{package}}: {{error}}", file=sys.stderr)


def _extend_datas(package: str) -> None:
    try:
        datas.extend(collect_data_files(package))
    except Exception as error:  # pragma: no cover - packaging-time guard
        print(f"[package.py] warning: failed to collect data files for {{package}}: {{error}}", file=sys.stderr)


for package_name in ({packages_literal}):
    _extend_hiddenimports(package_name)
    _extend_datas(package_name)

hiddenimports = sorted(set(hiddenimports))


a = Analysis(
    [str(server_dir / 'main.py')],
    pathex=[str(server_dir)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[r"{runtime_hook.resolve()}"],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='python_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='python_backend',
)
"""

    spec_path.write_text(spec_contents, encoding="utf-8")
    return spec_path


def build_python_backend(spec_path: Path, *, keep_artifacts: bool) -> None:
    """Freeze the FastAPI backend with PyInstaller."""

    if not spec_path.exists():
        raise PackagingError(f"PyInstaller spec file not found: {spec_path}")

    shutil.rmtree(PYINSTALLER_BUILD_DIR, ignore_errors=True)
    shutil.rmtree(PYINSTALLER_DIST_DIR, ignore_errors=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--workpath",
        str(PYINSTALLER_BUILD_DIR),
        "--distpath",
        str(PYINSTALLER_DIST_DIR),
        str(spec_path),
    ]
    run_command(command)

    dist_backend = PYINSTALLER_DIST_DIR / "python_backend"
    if not dist_backend.exists():
        raise PackagingError("PyInstaller build did not create the expected python_backend directory")

    target_backend = ELECTRON_DIR / "python_backend"
    shutil.rmtree(target_backend, ignore_errors=True)
    shutil.copytree(dist_backend, target_backend)

    if not keep_artifacts:
        shutil.rmtree(PYINSTALLER_BUILD_DIR, ignore_errors=True)
        shutil.rmtree(PYINSTALLER_DIST_DIR, ignore_errors=True)


def ensure_runtime_directories() -> None:
    """Guarantee that required resource directories exist before packaging."""

    for relative in ("meta", "data"):
        destination = ROOT / relative
        if not destination.exists():
            destination.mkdir(parents=True, exist_ok=True)

    static_dir = ELECTRON_DIR / "static"
    if not static_dir.exists():
        raise PackagingError(f"Electron static directory is missing: {static_dir}")

    assets_dir = ELECTRON_DIR / "dist" / "assets"
    if not assets_dir.exists():
        raise PackagingError(f"Electron assets directory is missing: {assets_dir}")


def update_electron_builder_config() -> None:
    """Patch electron/package.json so extra resources are bundled correctly."""

    package_json_path = ELECTRON_DIR / "package.json"
    if not package_json_path.exists():
        raise PackagingError(f"Electron package.json not found: {package_json_path}")

    package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
    build_config = package_data.setdefault("build", {})

    extra_resources = build_config.get("extraResources", [])
    if not isinstance(extra_resources, list):
        extra_resources = []

    def _ensure_mapping(src: str, dest: str) -> None:
        for item in extra_resources:
            if isinstance(item, dict) and item.get("to") == dest:
                item["from"] = src
                item.setdefault("filter", ["**/*"])
                return
        extra_resources.append({"from": src, "to": dest, "filter": ["**/*"]})

    for mapping in EXTRA_RESOURCE_MAPPINGS:
        _ensure_mapping(*mapping)

    build_config["extraResources"] = extra_resources

    asar_unpack = build_config.get("asarUnpack", [])
    if isinstance(asar_unpack, str):
        asar_unpack = [asar_unpack]
    elif not isinstance(asar_unpack, list):
        asar_unpack = []

    required_patterns = {
        "python_backend/**",
        "meta/**",
        "data/**",
        "static/**",
        "dist/assets/**",
    }
    asar_unpack_set = set(asar_unpack)
    asar_unpack_set.update(required_patterns)
    build_config["asarUnpack"] = sorted(asar_unpack_set)

    package_json_path.write_text(json.dumps(package_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ensure_node_dependencies(skip: bool) -> None:
    """Install npm dependencies if needed."""

    if skip:
        print("Skipping npm install at user request.")
        return

    if (ELECTRON_DIR / "node_modules").exists():
        print("node_modules already present; skipping npm install.")
        return

    run_command(["npm", "install"], cwd=ELECTRON_DIR)


def build_electron_bundle(target: str, skip: bool) -> None:
    """Invoke electron-builder to create the platform bundle."""

    if skip:
        print("Skipping electron-builder step at user request.")
        return

    target_script = f"build:{target}"
    env_overrides = {
        "NODE_ENV": "production",
        "ELECTRON_MIRROR": "https://npmmirror.com/mirrors/electron/",
        "ELECTRON_BUILDER_BINARIES_MIRROR": "https://npmmirror.com/mirrors/electron-builder-binaries/",
    }
    run_command(["npm", "run", target_script], cwd=ELECTRON_DIR, env=env_overrides)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """Configure command-line arguments for the packager."""

    parser = argparse.ArgumentParser(description="Package the Electron + Python application into a distributable bundle.")
    parser.add_argument("--target", choices=("mac", "win", "linux"), default="mac", help="electron-builder target to execute")
    parser.add_argument("--skip-pip", action="store_true", help="skip installing Python dependencies")
    parser.add_argument("--skip-python-build", action="store_true", help="skip rebuilding the PyInstaller backend")
    parser.add_argument("--keep-pyinstaller-artifacts", action="store_true", help="do not delete PyInstaller build directories after completion")
    parser.add_argument("--skip-npm", action="store_true", help="skip npm install")
    parser.add_argument("--skip-electron-build", action="store_true", help="skip running electron-builder")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    """Entry point for the packaging workflow."""

    args = parse_args(argv)
    validate_project_structure()

    install_python_dependencies(skip=args.skip_pip)
    runtime_hook = create_runtime_hook()
    spec_path = create_spec_file(runtime_hook)

    if args.skip_python_build:
        print("Skipping PyInstaller build step at user request.")
    else:
        build_python_backend(spec_path, keep_artifacts=args.keep_pyinstaller_artifacts)

    ensure_runtime_directories()
    update_electron_builder_config()
    ensure_node_dependencies(skip=args.skip_npm)
    build_electron_bundle(args.target, skip=args.skip_electron_build)

    print("\nPackaging workflow completed.")


if __name__ == "__main__":
    main()
