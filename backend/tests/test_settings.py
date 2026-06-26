import unittest

from app.core.config import Settings


class SettingsTests(unittest.TestCase):
    def test_cors_origins_parses_csv_and_trims_blanks(self) -> None:
        settings = Settings(
            app_cors_origins=" http://localhost:3000 , , http://192.168.0.116:3000 ,http://127.0.0.1:3000 "
        )

        self.assertEqual(
            settings.cors_origins,
            [
                "http://localhost:3000",
                "http://192.168.0.116:3000",
                "http://127.0.0.1:3000",
            ],
        )


if __name__ == "__main__":
    unittest.main()
