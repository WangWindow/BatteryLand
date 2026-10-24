"""Run the replaceable HTTP scheduling process from the repository root."""

import argparse
import logging
import math
import time

import httpx

from simple_impl.scheduler.client import FifoPolicy, SchedulerClient


def positive_interval(value: str) -> float:
    interval = float(value)
    if not math.isfinite(interval) or interval <= 0:
        raise argparse.ArgumentTypeError("Interval must be a finite positive number")
    return interval


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--interval", type=positive_interval, default=1.0)
    parser.add_argument("--policy", choices=["fifo"], default="fifo")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    with httpx.Client(base_url=args.base_url, timeout=90) as client:
        worker = SchedulerClient(client, FifoPolicy())
        try:
            while True:
                worker.tick()
                if args.once:
                    return
                time.sleep(args.interval)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
