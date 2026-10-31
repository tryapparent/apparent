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
local function install(node)
  local p = node.properties
  if p["media.class"] ~= "Stream/Output/Audio" or
      p["library.name"] ~= "audioconvert/libspa-audioconvert" or not p["object.serial"] then return end
  local serial = tostring(p["object.serial"])
  live[node] = serial
  node:enum_params("Props", function(iterator, err)
    if live[node] ~= serial or tostring(node.properties["object.serial"]) ~= serial then return end
    if not iterator then log:debug("Playback properties unavailable"); return end
    local ok, snapshot = pcall(function()
      local result = { supported = false, owned = false, filtered = false, channels = 0 }
      for pod in iterator:iterate() do
        local props = pod:parse().properties
        if props then
          if type(props.channelVolumes) == "table" then result.channels = #props.channelVolumes end
          local params = props.params or {}
          for i = 1, #params, 2 do
            local name, value = params[i], params[i + 1]
            if name == "audioconvert.filter-graph.disable" and value == false then result.supported = true end
            if name == marker .. ":Mult" then result.owned = true end
            if name == "audioconvert.filter-graph" and value ~= "" then result.filtered = true end
          end
        end
      end
      return result
    end)
    if not ok then log:debug("Playback properties could not be parsed"); return end
    -- Unknown layouts and pre-existing custom filter graphs are out of scope.
    -- A marker prevents reinstallation; it does NOT prove actual processing.
    if snapshot.owned or snapshot.filtered or not snapshot.supported or
        (snapshot.channels ~= 1 and snapshot.channels ~= 2) then return end
    local graph = Json.Object {
      nodes = Json.Array {
        Json.Object { type = "builtin", name = marker, label = "linear", control = Json.Object { Mult = 1.0, Add = 0.0 } },
        Json.Object { type = "apparentlease", name = "lease", label = "lease_v1" },
      },
      links = Json.Array { Json.Object { output = marker .. ":Out", input = "lease:In" } },
      inputs = Json.Array { marker .. ":In" }, outputs = Json.Array { "lease:Out" },
    }:get_data()
    node:set_param("Props", Pod.Object { "Spa:Pod:Object:Param:Props", "Props",
      params = Pod.Struct { key, graph } })
  end)
end
om:connect("object-added", function(_, node) install(node) end)
om:connect("object-removed", function(_, node) live[node] = nil end)
om:activate()
