#!/usr/bin/env python3
"""Run the shipped Lua policy against deferred WirePlumber-shaped snapshots.

This is a policy unit test, not native WirePlumber or measured-audio proof.
Uses an installed Lua library; does not install packages or touch audio services.
"""
import ctypes
import ctypes.util
import json
from pathlib import Path


FIXTURE = r'''
local timers, manager = {}, nil
local function identity(value) return value end
local function json(value)
  return setmetatable(value, { __index = {
    parse = function(self) return self end,
    get_data = function() return "graph" end,
  } })
end
Log = { open_topic = function() return { warning=identity, debug=identity, info=identity } end }
Conf = { get_section_as_json = function() return json({["exclusive-order-minus35"]=true}) end }
Json = { Object=json, Array=json }
Pod = { Object=identity, Struct=identity }
Interest = identity
Core = { timeout_add = function(_, callback)
  local timer={callback=callback}; timers[#timers+1]=timer; return timer
end }
ObjectManager = function()
  manager={callbacks={}}
  function manager:connect(event, callback) self.callbacks[event]=callback end
  function manager:activate() end
  return manager
end
assert(loadfile(POLICY_PATH))()
local function base(channels, disabled)
  local volumes={}; for i=1,channels do volumes[i]=1.0 end
  return {channelVolumes=volumes, params={"audioconvert.filter-graph.disable",disabled or false,
    "audioconvert.filter-graph",""}}
end
local function node(pods)
  local n={pods=pods,writes=0,reads=0,properties={
    ["media.class"]="Stream/Output/Audio", ["library.name"]="audioconvert/libspa-audioconvert",
    ["object.id"]="42", ["object.serial"]="9007199254740993"}}
  function n:enum_params(name, callback)
    assert(name=="Props"); self.reads=self.reads+1
    local captured=self.pods
    local iterator={iterate=function()
      local i=0
      return function()
        i=i+1; if captured[i] then
          return {parse=function() return {properties=captured[i]} end}
        end
      end
    end}
    local complete=function() callback(self.failed and nil or iterator, self.failed and "fixture failure" or nil) end
    if self.failed then complete=function() callback(nil,"fixture failure") end end
    if self.deferred then self.complete=complete else complete() end
  end
  function n:set_param(name,value)
    assert(name=="Props" and value.params[1]=="audioconvert.filter-graph.-35")
    assert(value.volume==nil and value.mute==nil and value.channelVolumes==nil)
    self.writes=self.writes+1
    self.pods[#self.pods+1]={params={"apparent_playback_v1:Mult",1.0}}
  end
  return n
end
local function drain()
  for _=1,100 do
    local any=false
    for _,timer in ipairs(timers) do
      if timer.callback then
        any=true
        if not timer.callback() then timer.callback=nil end
      end
    end
    if not any then return end
  end
  error("unbounded bootstrap timer")
end
local passed=0
local function check(name,pods,wanted)
  local n=node(pods); manager.callbacks["object-added"](manager,n); drain()
  assert(n.writes==wanted,name..": expected "..wanted.." writes, got "..n.writes)
  manager.callbacks["object-removed"](manager,n); passed=passed+1
end
check("mono",{base(1)},1)
check("stereo",{base(2)},1)
check("surround",{base(6)},0)
check("disabled updates",{base(2,true)},0)
check("controlled custom graph",{base(2),{params={"foreign:Mult",0.6}}},0)
check("control-free custom graph",{base(2),{params={}}},0)
check("owned graph",{base(2),{params={"apparent_playback_v1:Mult",1.0}}},0)
local missing_info=node({base(2)})
missing_info.properties["library.name"]=nil
manager.callbacks["object-added"](manager,missing_info)
assert(missing_info.writes==0)
missing_info.properties["library.name"]="audioconvert/libspa-audioconvert"; drain()
assert(missing_info.writes==1,"object-added may precede full node info")
manager.callbacks["object-removed"](manager,missing_info); passed=passed+1
local delayed=node({base(0)})
manager.callbacks["object-added"](manager,delayed)
assert(delayed.writes==0)
delayed.pods={base(2)}; drain()
assert(delayed.writes==1,"initial Props may precede channel negotiation")
manager.callbacks["object-removed"](manager,delayed); passed=passed+1
local stale=node({base(2)}); stale.deferred=true
manager.callbacks["object-added"](manager,stale)
manager.callbacks["object-removed"](manager,stale); stale.complete(); drain()
assert(stale.writes==0,"removed node callback wrote"); passed=passed+1
local reused=node({base(2)}); reused.deferred=true
manager.callbacks["object-added"](manager,reused)
reused.properties["object.serial"]="9007199254740994"; reused.complete(); drain()
assert(reused.writes==0,"reused identity callback wrote"); passed=passed+1
local expired=node({base(2)}); expired.deferred=true
manager.callbacks["object-added"](manager,expired); drain(); expired.complete()
assert(expired.writes==0,"callback after setup deadline wrote"); passed=passed+1
local failed=node({base(2)}); failed.failed=true
manager.callbacks["object-added"](manager,failed); drain()
assert(failed.writes==0 and failed.reads<=20,"failed setup must be bounded"); passed=passed+1
print("policy snapshot/deferred cases passed: "..passed)
'''


def main():
    library = next((ctypes.util.find_library(name) for name in ("lua5.4", "lua5.3", "lua")
                    if ctypes.util.find_library(name)), None)
    if library is None:
        raise SystemExit("Policy tests require an installed Lua 5.3/5.4 library")
    lua = ctypes.CDLL(library)
    lua.luaL_newstate.restype = ctypes.c_void_p
    lua.luaL_openlibs.argtypes = [ctypes.c_void_p]
    lua.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lua.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                              ctypes.c_ssize_t, ctypes.c_void_p]
    lua.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
    lua.lua_tolstring.restype = ctypes.c_char_p
    lua.lua_close.argtypes = [ctypes.c_void_p]
    state = lua.luaL_newstate()
    if not state:
        raise SystemExit("Could not allocate Lua state")
    try:
        lua.luaL_openlibs(state)
        source = "POLICY_PATH=" + json.dumps(str(Path(__file__).with_name("policy.lua"))) + "\n" + FIXTURE
        result = lua.luaL_loadstring(state, source.encode())
        if result == 0:
            result = lua.lua_pcallk(state, 0, 0, 0, 0, None)
        if result:
            raise SystemExit(lua.lua_tolstring(state, -1, None).decode())
    finally:
        lua.lua_close(state)


if __name__ == "__main__":
    main()
