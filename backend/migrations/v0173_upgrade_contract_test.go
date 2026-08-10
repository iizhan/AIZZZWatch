package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMigration206KeepsChannelThroughputPrivateByDefault(t *testing.T) {
	content, err := FS.ReadFile("206_channel_monitor_v2_privacy_defaults.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")
	require.Contains(t, sql, "SET value = 'true'")
	require.Contains(t, sql, "WHERE key = 'channel_monitor_hide_throughput'")
}

func TestMigration220BacksUpBeforeClearingOnlyNonGrokVideoPricing(t *testing.T) {
	content, err := FS.ReadFile("220_clear_non_grok_video_generation_config.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")
	backupAt := strings.Index(sql, "CREATE TABLE IF NOT EXISTS groups_video_price_backup_220")
	clearAt := strings.Index(sql, "UPDATE groups SET video_price_480p = NULL")
	require.GreaterOrEqual(t, backupAt, 0)
	require.Greater(t, clearAt, backupAt, "migration must snapshot prices before clearing them")
	require.Equal(t, 2, strings.Count(sql, "platform IS DISTINCT FROM 'grok'"))
	require.Equal(t, 2, strings.Count(sql, "platform IS DISTINCT FROM 'composite'"))
}
