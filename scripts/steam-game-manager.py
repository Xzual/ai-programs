"""E.D.I.T.H. bridge for the existing Mark-L Steam game updater."""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MARK_L_ROOT = PROJECT_ROOT / "Mark-L-main"
sys.path.insert(0, str(MARK_L_ROOT))

from actions.game_updater import (  # noqa: E402
    _find_steam_path,
    _get_steam_games,
    game_updater,
)


def main() -> int:
    try:
        request = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        action = str(request.get("action", "list")).strip().lower()

        if action == "search":
            query = str(request.get("game_name", "")).strip().lower()
            steam_path = _find_steam_path()
            games = _get_steam_games(steam_path) if steam_path else []
            matches = [game for game in games if not query or query in game["name"].lower()]
            print(json.dumps({"success": True, "action": action, "games": matches}, ensure_ascii=True))
            return 0

        if action not in {"list", "install", "download_status"}:
            raise ValueError("Unsupported Steam action.")

        result = game_updater(request)
        print(json.dumps({"success": True, "action": action, "result": result}, ensure_ascii=True))
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
