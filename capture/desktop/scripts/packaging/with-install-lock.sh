#!/usr/bin/env bash
# Cooperating installer lock; outside the replaced installation, never unlinked.
set -euo pipefail
exec /usr/bin/perl - "$@" <<'PERL'
use strict;
use warnings;
use Cwd qw(abs_path);
use File::Basename qw(dirname basename);
use Fcntl qw(:DEFAULT :flock F_SETFD);
my $app = shift @ARGV;
defined($app) && @ARGV or die "installation and command required\n";
$app =~ s{/+$}{};
-l $app and die "symlink installation\n";
my $parent = abs_path(dirname($app)) // die "installation parent missing\n";
my $path = "$parent/." . basename($app) . ".recipient.lock";
sysopen(my $lock, $path, O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0600) or die "unsafe installation lock: $!\n";
my @s = stat($lock);
$s[4] == $< && ($s[2] & 07777) == 0600 && ($s[2] & 0170000) == 0100000 && $s[3] == 1 or die "unsafe installation lock\n";
flock($lock, LOCK_EX | LOCK_NB) or die "installation busy\n";
# Keep the descriptor across exec; the executed shell owns its full lifetime.
fcntl($lock, F_SETFD, 0) or die "lock inheritance failed\n";
$^F = fileno($lock);
exec @ARGV;
die "installation command failed: $!\n";
PERL
