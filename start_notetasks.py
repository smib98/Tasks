#!/usr/bin/env python3
"""Build and start NoteTasks using values from config.ini."""

import argparse
import configparser
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.ini"
EXAMPLE_CONFIG_PATH = ROOT / "config.ini.example"


def load_config() -> configparser.ConfigParser:
    config = configparser.ConfigParser()
    if CONFIG_PATH.exists():
        config.read(CONFIG_PATH)
    return config


def config_value(config: configparser.ConfigParser, section: str, key: str, default: str) -> str:
    return os.environ.get(
        {
            ("server", "host"): "NOTETASKS_HOST",
            ("server", "http_port"): "NOTETASKS_HTTP_PORT",
            ("server", "https_port"): "NOTETASKS_HTTPS_PORT",
        }.get((section, key), ""),
        config.get(section, key, fallback=default),
    )


def config_bool(config: configparser.ConfigParser, section: str, key: str, default: bool) -> bool:
    env_name = "NOTETASKS_HTTPS_ENABLED" if (section, key) == ("server", "https_enabled") else ""
    raw = os.environ.get(env_name) if env_name else None
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return config.getboolean(section, key, fallback=default)


def probe_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::", ""} else host


def port_is_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((probe_host(host), port)) != 0


def pids_on_port(port: int) -> list[int]:
    pids: set[int] = set()
    commands: list[tuple[str, list[str], str]] = []
    if shutil.which("lsof"):
        commands.append(("lsof", ["-ti", f"tcp:{port}", "-sTCP:LISTEN"], r"\b\d+\b"))
    if shutil.which("fuser"):
        commands.append(("fuser", [f"{port}/tcp"], r"\b\d+\b"))
    if shutil.which("ss"):
        commands.append(("ss", ["-ltnp", f"sport = :{port}"], r"pid=(\d+)"))

    for command, args, pattern in commands:
        result = subprocess.run([command, *args], text=True, capture_output=True, check=False)
        output = f"{result.stdout}\n{result.stderr}"
        pids.update(int(match) for match in re.findall(pattern, output))
        if pids:
            break
    return sorted(pid for pid in pids if pid != os.getpid())


def pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def replace_port_processes(host: str, port: int) -> bool:
    pids = pids_on_port(port)
    if not pids:
        print(f"Port {port} is busy, but its listener could not be identified.", file=sys.stderr)
        return False

    print(f"Stopping listener(s) on port {port}: {', '.join(map(str, pids))}")
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    deadline = time.time() + 6
    while time.time() < deadline:
        if port_is_available(host, port):
            return True
        time.sleep(0.2)

    for pid in pids:
        if pid_is_running(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    time.sleep(0.3)
    return port_is_available(host, port)


def ensure_port(host: str, port: int, replace: bool) -> bool:
    if port_is_available(host, port):
        return True
    if replace:
        return replace_port_processes(host, port)
    print(
        f"Port {port} is already in use. Stop that service, choose another port in config.ini, "
        "or pass --replace-port-process.",
        file=sys.stderr,
    )
    return False


def run_checked(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def start_process(name: str, command: list[str], env: dict[str, str]) -> subprocess.Popen:
    print(f"Starting {name}: {' '.join(command)}")
    return subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)


def main() -> int:
    config = load_config()
    default_host = config_value(config, "server", "host", "127.0.0.1")
    default_http_port = int(config_value(config, "server", "http_port", "3000"))
    default_https_port = int(config_value(config, "server", "https_port", "3443"))
    default_https = config_bool(config, "server", "https_enabled", False)

    parser = argparse.ArgumentParser(description="Build and start the NoteTasks local service.")
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--http-port", type=int, default=default_http_port)
    parser.add_argument("--https-port", type=int, default=default_https_port)
    parser.add_argument("--no-http", action="store_true", help="Do not start the HTTP service.")
    parser.add_argument("--https", action=argparse.BooleanOptionalAction, default=default_https)
    parser.add_argument("--build", action="store_true", help="Create the database and production build first.")
    parser.add_argument("--skip-cert", action="store_true", help="Skip creating/checking the HTTPS certificate.")
    parser.add_argument(
        "--replace-port-process",
        action="store_true",
        help="Stop an existing listener on an app port. Disabled by default for safety.",
    )
    args = parser.parse_args()

    if not CONFIG_PATH.exists():
        if not EXAMPLE_CONFIG_PATH.exists():
            print("Missing config.ini and config.ini.example.", file=sys.stderr)
            return 2
        shutil.copyfile(EXAMPLE_CONFIG_PATH, CONFIG_PATH)
        print("Created config.ini from config.ini.example. Add a Gemini key there if you want AI features.")

    if args.no_http and not args.https:
        print("Nothing to start: --no-http was supplied while HTTPS is disabled.", file=sys.stderr)
        return 2

    if args.build:
        run_checked(["npm", "run", "db:push"])
        run_checked(["npm", "run", "build"])

    if args.https and not args.skip_cert:
        run_checked(["npm", "run", "setup:https"])

    requested_ports = []
    if not args.no_http:
        requested_ports.append(args.http_port)
    if args.https:
        requested_ports.append(args.https_port)
    if any(not ensure_port(args.host, port, args.replace_port_process) for port in requested_ports):
        return 1

    env = os.environ.copy()
    env["NOTETASKS_HOST"] = args.host
    env["NOTETASKS_HTTP_PORT"] = str(args.http_port)
    env["NOTETASKS_HTTPS_PORT"] = str(args.https_port)

    processes: list[subprocess.Popen] = []
    try:
        if not args.no_http:
            processes.append(start_process("NoteTasks HTTP", ["npm", "run", "start"], env))
        if args.https:
            processes.append(start_process("NoteTasks HTTPS", ["npm", "run", "start:https"], env))

        shown_host = "localhost" if args.host in {"0.0.0.0", "127.0.0.1"} else args.host
        print()
        if not args.no_http:
            print(f"HTTP:  http://{shown_host}:{args.http_port}")
        if args.https:
            print(f"HTTPS: https://{shown_host}:{args.https_port}")
        print("Press Ctrl+C to stop NoteTasks.")

        while True:
            for process in processes:
                if process.poll() is not None:
                    return process.returncode or 0
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping NoteTasks...")
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
