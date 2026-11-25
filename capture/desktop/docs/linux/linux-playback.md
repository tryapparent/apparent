# Remove the retired Linux playback experiment

Apparent ignores the old enable flag. If you manually installed the experiment,
remove the components below when you can interrupt your audio session.

1. Finish or cancel any capture running in an older build and wait for its
   playback helper to exit.
2. Remove the files you installed for the experiment:
   - `~/.config/wireplumber/wireplumber.conf.d/90-apparent-playback.conf`
   - `~/.local/share/wireplumber/scripts/apparent-playback.lua`
   - `~/.config/systemd/user/wireplumber.service.d/90-apparent-playback.conf`
3. Run `systemctl --user daemon-reload`, then log out and back in to release the
   audio filters.
4. Remove `~/.local/lib/apparent/apparent-playback-helper` and the installed
   `libspa-filter-graph-plugin-apparentlease.so`. The setup guide used
   `/usr/lib/spa-0.2/filter-graph/` for the module.

Leave the active lease file to the session's normal cleanup.
