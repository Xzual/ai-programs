import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.obsidian_path import resolve_obsidian_vault_path, validate_obsidian_vault_path


class WorkspaceObsidianPathTests(unittest.TestCase):
    def test_missing_configuration_is_explicit(self):
        with patch.dict(os.environ, {}, clear=True):
            result = resolve_obsidian_vault_path()
        self.assertFalse(result["ok"])
        self.assertIsNone(result["vaultPath"])
        self.assertEqual(result["errorCode"], "OBSIDIAN_PATH_CONFIGURATION_REQUIRED")

    def test_unicode_environment_path_is_preserved(self):
        value = r"C:\Kullanıcı\EDİTH Bilgi Kasası"
        with patch.dict(os.environ, {"EDITH_OBSIDIAN_VAULT_PATH": value}, clear=True):
            result = resolve_obsidian_vault_path()
        self.assertTrue(result["ok"])
        self.assertEqual(result["vaultPath"], value)
        self.assertIsNone(result["expectedPath"])

    def test_workspace_style_config_path_is_read(self):
        with tempfile.TemporaryDirectory(prefix="edith-path-") as directory:
            config_path = Path(directory) / "workspace.json"
            vault_path = str(Path(directory) / "Obsidian")
            config_path.write_text(json.dumps({"obsidianVaultPath": vault_path}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                result = resolve_obsidian_vault_path(config_path)
        self.assertTrue(result["ok"])
        self.assertEqual(result["source"], "config")
        self.assertEqual(result["vaultPath"], vault_path)

    def test_empty_and_mojibake_paths_are_rejected(self):
        self.assertEqual(validate_obsidian_vault_path("")["errorCode"], "OBSIDIAN_PATH_CONFIGURATION_REQUIRED")
        self.assertEqual(
            validate_obsidian_vault_path(r"C:\ED─░TH\Vault")["errorCode"],
            "OBSIDIAN_PATH_ENCODING_ERROR",
        )

    def test_runtime_resolver_has_no_fixed_drive_default(self):
        source = Path(__file__).parent / "src" / "obsidian_path.py"
        content = source.read_text(encoding="utf-8")
        self.assertNotIn("D:\\ED", content)
        self.assertNotIn("EXPECTED_VAULT_PATH", content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
