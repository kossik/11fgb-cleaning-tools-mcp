#!/usr/bin/env sh

set -eu

case "${SSH_ORIGINAL_COMMAND:-}" in
	"deploy "[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
		set -- ${SSH_ORIGINAL_COMMAND}
		[ "$1" = deploy ] && [ ${#2} -eq 40 ] && echo "$2" | grep -Eq '^[0-9a-f]{40}$' || exit 2
		exec sudo /usr/local/sbin/11fgb-mcp-deploy "$2"
		;;
	*)
		echo 'Only deploy <40-character-sha> is allowed.' >&2
		exit 2
		;;
esac
