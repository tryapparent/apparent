from time import monotonic_ns

worker_entry = monotonic_ns()

import base64
from contextlib import contextmanager
from hashlib import sha256
import importlib.util
import io
import json
from pathlib import Path
import resource
import sys
from types import SimpleNamespace


class HermesToolHostFixture:
    def __init__(self, executable):
        self.executable = executable
        self.tools = {}
        self.hooks = {}

    def register_tool(self, **entry):
        self.tools[entry["name"]] = entry

    def register_hook(self, name, handler):
        self.hooks[name] = handler

    def register_skill(self, name, path, **kwargs):
        assert name == "recordings" and path.is_file()

    def register_rpc(self, name, handler):
        assert name == "setup_status" and callable(handler)

    def get_config(self, name, default):
        assert name == "executable"
        return self.executable

    def deliver(self, value):
        return value


class Trace:
    def __init__(self):
        self.spans = []
        self.stack = []

    @contextmanager
    def span(self, name):
        index = len(self.spans)
        span = {"name": name, "parent": self.stack[-1] if self.stack else None,
                "startNs": monotonic_ns()}
        self.spans.append(span)
        self.stack.append(index)
        try:
            yield
        finally:
            span["endNs"] = monotonic_ns()
            self.stack.pop()

    def wrap(self, name, target):
        def traced(*args, **kwargs):
            with self.span(name(*args, **kwargs) if callable(name) else name):
                return target(*args, **kwargs)
        return traced


def instrument(plugin, trace):
    adapter = plugin.adapter
    process = plugin.process
    evidence = plugin.evidence
    plugin.executable = trace.wrap("resolve CLI dependency", plugin.executable)
    adapter.Adapter.inspect = trace.wrap("source validation and dispatch", adapter.Adapter.inspect)
    adapter.execute = trace.wrap(
        lambda command, args: "CLI manifest" if "--json" in args else "CLI summary",
        adapter.execute,
    )
    adapter.json = SimpleNamespace(loads=trace.wrap("manifest JSON decoding", json.loads))
    evidence.read_image = trace.wrap("confined PNG read and JPEG encoding", evidence.read_image)
    adapter.result = trace.wrap("multimodal envelope and base64", adapter.result)
    launch = trace.wrap("launch supervisor", process.subprocess.Popen)
    make_selector = process.selectors.DefaultSelector

    def traced_process(*args, **kwargs):
        child = launch(*args, **kwargs)
        child.wait = trace.wrap("reap supervisor", child.wait)
        return child

    def traced_selector():
        selector = make_selector()
        selector.select = trace.wrap("await CLI pipe readiness", selector.select)
        return selector

    system = process.os
    process.os = SimpleNamespace(pipe=system.pipe, close=system.close, read=system.read, environ=system.environ,
                                 killpg=trace.wrap("signal supervisor group", system.killpg))
    process.selectors = SimpleNamespace(DefaultSelector=traced_selector, EVENT_READ=process.selectors.EVENT_READ)
    process.subprocess = SimpleNamespace(
        Popen=traced_process,
        DEVNULL=process.subprocess.DEVNULL,
        PIPE=process.subprocess.PIPE,
        TimeoutExpired=process.subprocess.TimeoutExpired,
    )


def resources():
    return [resource.getrusage(which) for which in (resource.RUSAGE_SELF, resource.RUSAGE_CHILDREN)]


def cpu_seconds(usage):
    return sum(row.ru_utime + row.ru_stime for row in usage)


def resource_receipt(start, end):
    cpu = cpu_seconds(end) - start
    return {"cpuMs": cpu * 1000, "pluginPeakRssKiB": end[0].ru_maxrss,
            "descendantPeakRssKiB": end[1].ru_maxrss}


def fixture_files(bundle, fixture):
    return [bundle / "apparent.json", bundle / fixture["contactSheet"]]


def create_fixture(bundle, fixture):
    from PIL import Image

    bundle.mkdir()
    manifest = {**fixture["bundle"], "contactSheet": fixture["contactSheet"],
                "transcript": {"source": "test", "text": fixture["text"], "segments": []}}
    paths = fixture_files(bundle, fixture)
    paths[0].write_text(json.dumps(manifest), encoding="utf-8")
    Image.new("RGB", (fixture["width"], fixture["height"]), fixture["color"]).save(paths[1])


def verify(value, bundle, fixture):
    from PIL import Image

    assert value["_multimodal"] is True
    text, image = value["content"]
    summary = text["text"]
    assert text["type"] == "text" and summary == value["text_summary"]
    assert summary.startswith(f"Source: {bundle}\n") and fixture["text"] in summary
    event = fixture["bundle"]["events"][0]
    assert f"· 0:{event['t'] // 1000:02d} Typed note · pin {event['pin']}:" in summary
    assert event["text"] in summary
    assert image["type"] == "image_url"
    mime, encoded = image["image_url"]["url"].split(",", 1)
    assert mime == "data:image/jpeg;base64"
    jpeg = base64.b64decode(encoded, validate=True)
    with Image.open(io.BytesIO(jpeg)) as decoded:
        assert decoded.format == "JPEG" and decoded.size == (fixture["width"], fixture["height"])
        decoded.load()
        for point in ((0, 0), (decoded.width // 2, decoded.height // 2), (decoded.width - 1, decoded.height - 1)):
            red, green, blue = decoded.getpixel(point)
            assert red > 240 and green + blue < 20
    return {"transcriptVerified": True, "interactionVerified": True, "pixelsVerified": True,
            "resultSha256": sha256(json.dumps(value, sort_keys=True).replace(str(bundle), "<bundle>").encode()).hexdigest(),
            "imageBytes": len(jpeg)}


def load(plugin_root):
    spec = importlib.util.spec_from_file_location(
        "apparent_benchmark_plugin", plugin_root / "__init__.py",
        submodule_search_locations=[str(plugin_root)],
    )
    plugin = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = plugin
    spec.loader.exec_module(plugin)
    return plugin


def run(plugin_root, executable, bundle, traced, fixture):
    trace = Trace() if traced else None
    probe_ready = monotonic_ns()

    def invoke(phase, host=None):
        start = monotonic_ns()
        if host is None:
            prepare = trace.wrap("plugin and dependency import", load) if trace else load
            plugin = prepare(plugin_root)
            if trace:
                instrument(plugin, trace)
            host = HermesToolHostFixture(executable)
            register = trace.wrap("Hermes tool registration", plugin.register) if trace else plugin.register
            register(host)

        def dispatch():
            guidance = host.hooks["pre_llm_call"](user_message=f"Inspect {bundle}")
            assert guidance and "apparent_inspect" in guidance["context"]
            tool = host.tools["apparent_inspect"]
            return tool["handler"]({"source": str(bundle)})

        dispatch_tool = trace.wrap("Hermes hook and tool dispatch", dispatch) if trace else dispatch
        value = dispatch_tool()
        deliver = trace.wrap("deliver to Hermes tool host fixture", host.deliver) if trace else host.deliver
        value = deliver(value)
        return host, start, monotonic_ns(), value

    rows = []
    host = None
    before = 0
    for phase in ("cold", "warm"):
        if trace:
            trace.spans = []
        host, start, delivered, value = invoke(phase, host)
        after = resources()
        row = {"phase": phase, "dispatchStartNs": start, "deliveredNs": delivered,
               "spans": trace.spans if trace else [], "verification": verify(value, bundle, fixture),
               "resources": resource_receipt(before, after)}
        if phase == "cold":
            row["workerEntryNs"] = worker_entry
            row["probeReadyNs"] = probe_ready
        rows.append(row)
        before = cpu_seconds(resources())
    return rows


if __name__ == "__main__":
    mode, fixture_file, bundle_root, *args = sys.argv[1:]
    fixture = json.loads(Path(fixture_file).read_text())
    bundle = Path(bundle_root)
    if mode == "fixture":
        create_fixture(bundle, fixture)
    elif mode == "probe":
        rows = run(Path(args[0]), args[1], bundle, args[2] == "trace", fixture)
        print(json.dumps({"pythonVersion": sys.version.split()[0],
                          "pillowVersion": sys.modules["PIL"].__version__, "attempts": rows,
                          "totalCpuMs": cpu_seconds(resources()) * 1000}))
    else:
        raise ValueError(f"Unknown benchmark probe mode {mode}")
