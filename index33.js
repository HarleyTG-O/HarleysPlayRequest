const { Client, GatewayIntentBits, REST, Routes, ButtonBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { ButtonStyle } = require('discord.js');

// Load environment variables and constants
const { TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID, REPORT_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, REQUEST_MENU_CHANNEL_ID } = require('./config.json');

// Define the configuration for embeds and actions
const config = {
    main: {
        embed: {
            title: "Play Request",
            description: "A new play request has been made.",
            fields: [
                { name: "Play Request ID", value: "{playRequestId}", inline: true },
                { name: "Game", value: "{game}", inline: true },
                { name: "Requester", value: "{requester}", inline: true },
                { name: "Message", value: "{message}", inline: false }
            ],
            footer: "Use the buttons below to respond."
        },
        actionRow: {
            buttons: [
                { label: "Accept", customId: "accept_{playRequestId}", style: "SUCCESS" },
                { label: "Deny", customId: "deny_{playRequestId}", style: "DANGER" },
                { label: "Report", customId: "report_{playRequestId}", style: "SECONDARY" }
            ]
        }
    },
    dm: {
        embed: {
            title: "Play Request Preview",
            description: "Here is a preview of the play request.",
            fields: [
                { name: "Play Request ID", value: "{playRequestId}", inline: true },
                { name: "Game", value: "{game}", inline: true },
                { name: "Requester", value: "{requester}", inline: true }
            ],
            footer: "No action buttons available."
        }
    },
    report: {
        embed: {
            title: "Play Request Report",
            description: "Details of the reported play request.",
            fields: [
                { name: "Play Request ID", value: "{playRequestId}", inline: true },
                { name: "Game", value: "{game}", inline: true },
                { name: "Requester", value: "{requester}", inline: true },
                { name: "Message", value: "{message}", inline: false },
                { name: "Reason", value: "{reason}", inline: true },
                { name: "Reported By", value: "{reportedBy}", inline: true }
            ],
            footer: "Manage the request using the buttons below."
        },
        actionRow: {
            buttons: [
                { label: "Delete", customId: "delete_{playRequestId}", style: "DANGER" },
                { label: "Ban Requester", customId: "ban_{requester}", style: "DANGER" },
                { label: "Warn", customId: "warn_{requester}", style: "SECONDARY" }
            ]
        }
    }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isCommand()) {
            const { commandName } = interaction;

            if (commandName === 'play') {
                const game = interaction.options.getString('game');
                const user = interaction.user;

                const playRequestId = Date.now().toString();
                const playRequestEmbed = new EmbedBuilder()
                    .setTitle(config.main.embed.title)
                    .setDescription(config.main.embed.description)
                    .addFields(
                        { name: config.main.embed.fields[0].name, value: playRequestId, inline: config.main.embed.fields[0].inline },
                        { name: config.main.embed.fields[1].name, value: game, inline: config.main.embed.fields[1].inline },
                        { name: config.main.embed.fields[2].name, value: user.tag, inline: config.main.embed.fields[2].inline },
                        { name: config.main.embed.fields[3].name, value: 'Click a button to respond', inline: config.main.embed.fields[3].inline }
                    )
                    .setFooter({ text: config.main.embed.footer });

                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel(config.main.actionRow.buttons[0].label.replace('{playRequestId}', playRequestId))
                            .setCustomId(config.main.actionRow.buttons[0].customId.replace('{playRequestId}', playRequestId))
                            .setStyle(config.main.actionRow.buttons[0].style),
                        new ButtonBuilder()
                            .setLabel(config.main.actionRow.buttons[1].label.replace('{playRequestId}', playRequestId))
                            .setCustomId(config.main.actionRow.buttons[1].customId.replace('{playRequestId}', playRequestId))
                            .setStyle(config.main.actionRow.buttons[1].style),
                        new ButtonBuilder()
                            .setLabel(config.main.actionRow.buttons[2].label.replace('{playRequestId}', playRequestId))
                            .setCustomId(config.main.actionRow.buttons[2].customId.replace('{playRequestId}', playRequestId))
                            .setStyle(config.main.actionRow.buttons[2].style)
                    );

                const requestChannel = await client.channels.fetch(REQUEST_MENU_CHANNEL_ID);
                await requestChannel.send({ embeds: [playRequestEmbed], components: [actionRow] });

                await interaction.reply({ content: `Your play request for ${game} has been submitted!` });
            } else if (commandName === 'playend') {
                const id = interaction.options.getString('id');

                if (playRequests.has(id)) {
                    const request = playRequests.get(id);
                    request.status = 'Ended';
                    playRequests.set(id, request);

                    writePlayRequests(playRequests);

                    await interaction.reply({ content: `Play request ${id} has been ended.` });
                } else {
                    await interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }
            } else if (commandName === 'ban') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason');

                if (!user) {
                    return interaction.reply({ content: 'User not found!', ephemeral: true });
                }

                const bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(user.id)) {
                    bannedUsers.push(user.id);
                    writeBannedUsers(bannedUsers);

                    await interaction.reply({ content: `User <@${user.id}> has been banned for: ${reason}` });
                } else {
                    await interaction.reply({ content: 'User is already banned!', ephemeral: true });
                }
            } else if (commandName === 'unban') {
                const userId = interaction.options.getString('user');

                const bannedUsers = readBannedUsers();
                const index = bannedUsers.indexOf(userId);
                if (index !== -1) {
                    bannedUsers.splice(index, 1);
                    writeBannedUsers(bannedUsers);

                    await interaction.reply({ content: `User <@${userId}> has been unbanned.` });
                } else {
                    await interaction.reply({ content: 'User is not banned!', ephemeral: true });
                }
            } else if (commandName === 'report') {
                const id = interaction.options.getString('id');
                const reason = interaction.options.getString('reason');

                if (playRequests.has(id)) {
                    const request = playRequests.get(id);
                    const reportEmbed = new EmbedBuilder()
                        .setTitle(config.report.embed.title)
                        .setDescription(config.report.embed.description)
                        .addFields(
                            { name: config.report.embed.fields[0].name, value: id, inline: config.report.embed.fields[0].inline },
                            { name: config.report.embed.fields[1].name, value: request.game, inline: config.report.embed.fields[1].inline },
                            { name: config.report.embed.fields[2].name, value: request.userId, inline: config.report.embed.fields[2].inline },
                            { name: config.report.embed.fields[3].name, value: request.message || 'No message', inline: config.report.embed.fields[3].inline },
                            { name: config.report.embed.fields[4].name, value: reason, inline: config.report.embed.fields[4].inline },
                            { name: config.report.embed.fields[5].name, value: interaction.user.tag, inline: config.report.embed.fields[5].inline }
                        )
                        .setFooter({ text: config.report.embed.footer });

                    const reportActionRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel(config.report.actionRow.buttons[0].label.replace('{playRequestId}', id))
                                .setCustomId(config.report.actionRow.buttons[0].customId.replace('{playRequestId}', id))
                                .setStyle(config.report.actionRow.buttons[0].style),
                            new ButtonBuilder()
                                .setLabel(config.report.actionRow.buttons[1].label.replace('{requester}', request.userId))
                                .setCustomId(config.report.actionRow.buttons[1].customId.replace('{requester}', request.userId))
                                .setStyle(config.report.actionRow.buttons[1].style),
                            new ButtonBuilder()
                                .setLabel(config.report.actionRow.buttons[2].label.replace('{requester}', request.userId))
                                .setCustomId(config.report.actionRow.buttons[2].customId.replace('{requester}', request.userId))
                                .setStyle(config.report.actionRow.buttons[2].style)
                        );

                    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                    await logChannel.send({ embeds: [reportEmbed], components: [reportActionRow] });

                    await interaction.reply({ content: 'Report submitted successfully!' });
                } else {
                    await interaction.reply({ content: 'Play request not found!', ephemeral: true });
                }
            }
        } else if (interaction.isButton()) {
            const [action, id] = interaction.customId.split('_');
            const playRequest = playRequests.get(id);

            if (action === 'accept') {
                if (playRequest) {
                    playRequest.status = 'Accepted';
                    playRequests.set(id, playRequest);
                    writePlayRequests(playRequests);

                    const user = await client.users.fetch(playRequest.userId);
                    await user.send(`Your play request for ${playRequest.game} has been accepted!`);
                    await interaction.update({ content: 'Play request accepted!', components: [] });
                } else {
                    await interaction.update({ content: 'Play request not found!', components: [] });
                }
            } else if (action === 'deny') {
                if (playRequest) {
                    playRequest.status = 'Denied';
                    playRequests.set(id, playRequest);
                    writePlayRequests(playRequests);

                    const user = await client.users.fetch(playRequest.userId);
                    await user.send(`Your play request for ${playRequest.game} has been denied.`);
                    await interaction.update({ content: 'Play request denied!', components: [] });
                } else {
                    await interaction.update({ content: 'Play request not found!', components: [] });
                }
            } else if (action === 'report') {
                // Report logic handled by /report command
                await interaction.reply({ content: 'Use the /report command to report play requests.', ephemeral: true });
            } else if (action === 'delete') {
                if (playRequest) {
                    playRequests.delete(id);
                    writePlayRequests(playRequests);

                    await interaction.update({ content: 'Play request deleted.', components: [] });
                } else {
                    await interaction.update({ content: 'Play request not found!', components: [] });
                }
            } else if (action === 'ban') {
                const userId = interaction.customId.split('_')[1];
                const bannedUsers = readBannedUsers();
                if (!bannedUsers.includes(userId)) {
                    bannedUsers.push(userId);
                    writeBannedUsers(bannedUsers);

                    await interaction.update({ content: `User <@${userId}> has been banned.`, components: [] });
                } else {
                    await interaction.update({ content: 'User is already banned.', components: [] });
                }
            } else if (action === 'warn') {
                // Warn logic should be implemented here
                await interaction.update({ content: 'Warn functionality is not yet implemented.', components: [] });
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply({ content: 'There was an error while processing your request.', ephemeral: true });
    }
});

client.login(TOKEN);
