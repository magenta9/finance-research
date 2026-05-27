#!/usr/bin/env python3

import json
import platform


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "python": platform.python_version(),
                "status": "dummy-ok",
            }
        )
    )
