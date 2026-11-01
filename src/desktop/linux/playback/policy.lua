-- SPDX-License-Identifier: MIT
-- Optional, manually installed policy. Tested only with PipeWire 1.6.9 and
-- WirePlumber 0.5.18. No status metadata or claim of per-stream effectiveness.
-- Install one neutral processor per ordinary mono/stereo playback stream.
-- The capture helper alone publishes a short lease; its expiry restores unity
-- even with this policy stopped. Do not reuse order -35 for another policy.
local log = Log.open_topic("apparent-playback")
local opts = Conf.get_section_as_json("apparent.playback", Json.Object{}):parse()
if opts["exclusive-order-minus35"] ~= true then
  log:warning("Playback experiment requires manual reservation of filter order -35")
  return
end
local key, marker = "audioconvert.filter-graph.-35", "apparent_playback_v1"
local om = ObjectManager { Interest { type = "node" } }
local live = {}
local function current(node, state)
  return live[node] == state and not state.done and
    tostring(node.properties["object.serial"]) == state.serial
end
local function install(node, state)
  if not current(node, state) or state.busy then return end
  local p = node.properties
  -- Object-added can precede the full node info and channel negotiation.
  if not p["media.class"] or not p["library.name"] then return end
  if p["media.class"] ~= "Stream/Output/Audio" or
      p["library.name"] ~= "audioconvert/libspa-audioconvert" then state.done = true; return end
  state.busy = true
  node:enum_params("Props", function(iterator, err)
    if not current(node, state) then return end
    state.busy = false
    if not iterator then log:debug("Playback properties unavailable"); return end
    local ok, snapshot = pcall(function()
      local result = { supported = false, owned = false, count = 0, channels = 0 }
      for pod in iterator:iterate() do
        result.count = result.count + 1
        local props = pod:parse().properties
        if props then
          if type(props.channelVolumes) == "table" then result.channels = #props.channelVolumes end
          local params = props.params or {}
          for i = 1, #params, 2 do
            local name, value = params[i], params[i + 1]
            if name == "audioconvert.filter-graph.disable" and value == false then result.supported = true end
            if name == marker .. ":Mult" then result.owned = true end
          end
        end
      end
      return result
    end)
    if not ok then log:debug("Playback properties could not be parsed"); return end
    -- On 1.6.9 the generic graph string is always empty. Each existing graph
    -- contributes an additional Props object, even when it has no controls.
    -- A marker prevents reinstallation; it does NOT prove actual processing.
    if snapshot.owned or snapshot.count > 1 then state.done = true; return end
    if not snapshot.supported or snapshot.channels == 0 then return end
    if snapshot.channels ~= 1 and snapshot.channels ~= 2 then state.done = true; return end
    local graph = Json.Object {
      nodes = Json.Array {
        Json.Object { type = "builtin", name = marker, label = "linear", control = Json.Object { Mult = 1.0, Add = 0.0 } },
        Json.Object { type = "apparentlease", name = "lease", label = "lease_v1" },
      },
      links = Json.Array { Json.Object { output = marker .. ":Out", input = "lease:In" } },
      inputs = Json.Array { marker .. ":In" }, outputs = Json.Array { "lease:Out" },
    }:get_data()
    state.done = true -- One setup write; no live monitoring or repair loop.
    node:set_param("Props", Pod.Object { "Spa:Pod:Object:Param:Props", "Props",
      params = Pod.Struct { key, graph } })
  end)
end
om:connect("object-added", function(_, node)
  local state = { serial = tostring(node.properties["object.serial"]), ticks = 0 }
  live[node] = state
  install(node, state)
  state.timer = Core.timeout_add(200, function()
    if not current(node, state) then return false end
    state.ticks = state.ticks + 1
    if state.ticks >= 20 then
      state.done = true
      return false
    end
    install(node, state)
    return not state.done
  end)
end)
om:connect("object-removed", function(_, node) live[node] = nil end)
om:activate()
-- Keep the manager and pending setup state alive for the script's lifetime.
APPARENT_PLAYBACK_POLICY = { manager = om, live = live }
