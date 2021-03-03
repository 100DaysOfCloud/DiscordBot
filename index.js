import { Client, MessageEmbed } from 'discord.js';
import AWS from 'aws-sdk';

// Use .env variables
import * as dotenv from 'dotenv';
dotenv.config();

AWS.config.update({
	region: process.env.AWS_DEFAULT_REGION,
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Discord client
const client = new Client();

// DynamoDB client
const dbClient = new AWS.DynamoDB.DocumentClient();

// Register an event so that when the bot is ready, it will log a messsage to the terminal
client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

// Register an event to handle incoming messages
client.on('message', async (msg) => {
	// Handling daily logging messages
	if (msg.content.startsWith('$logday')) {
		// If the both is the message author, disregard
		let filter = (msg) => !msg.author.bot;

		// Accept only one answer in the next 15 seconds
		let options = {
			max: 1,
			time: 15000,
		};

		// Create message collector to accept incoming chat messages
		const collector = msg.channel.createMessageCollector(filter, options);

		// Instantiate empty payload to be filled on collection
		let payload = {};

		collector.on('collect', (message) => {
			const timestamp = new Date(message.createdAt);
			payload = {
				user_id: message.author.id,
				message: message.content,
				timestamp: timestamp.toLocaleDateString('en-US'),
			};
		});

		collector.on('end', (_) => {
			const params = {
				TableName: process.env.DYNAMODB_TABLE_NAME,
				Item: {
					user_id: payload.user_id,
					message: payload.message,
					log_date: payload.timestamp,
				},
				ConditionExpression: 'log_date <> :timestampVal',
				ExpressionAttributeValues: {
					':timestampVal': payload.timestamp,
				},
			};

			dbClient.put(params, (error) => {
				if (!error) {
					// Finally, return a message to the user stating that the app was saved
					console.log(payload);
				} else {
					console.log(error);
					msg.reply(
						"You already logged your progress today. You can't log more than once per day!"
					);
				}
			});
		});

		// Check if the message starts with '!hello' and respond with 'world!' if it does.
		msg.reply('What do you want to log for today?');
	}

	if (msg.content.startsWith('$getlogs')) {
		// DDB query parameters to check for all the logs from the current user

		// $getlogs only accepts 1 additional argument, the number of logs to show
		const command = msg.content.split(' ').slice(1);

		// defaults to 10 if not provided
		let numberOfLogs = 10;

		// Checking if we have exactly one argument
		if (command.length == 1) {
			numberOfLogs = Number(command[0]);
			console.log(numberOfLogs);
			if (isNaN(numberOfLogs)) {
				msg.reply('Please input a number');
				return;
			}
		}
		// Replying with an error message and preventing a DDB query to be executed
		else if (command.length > 1) {
			msg.reply('I received more arguments that I can handle!');
			return;
		}

		if (numberOfLogs < 0) {
			msg.reply(
				'Please, enter either a positive number or 0 if you want to look at all your logs!'
			);
			return;
		}

		// Query parameters for the DynamoDB put call
		var params = {
			ExpressionAttributeValues: {
				':user_id': msg.author.id,
			},
			KeyConditionExpression: 'user_id = :user_id',
			TableName: process.env.DYNAMODB_TABLE_NAME,
		};

		// Initialize empty user body
		let logHistory = [];

		// Initialize empty date array for streak calculations
		let logDates = [];

		dbClient.query(params, function (err, data) {
			// Reply something on error but logs the error.
			if (err) {
				console.log(err);
				msg.reply('Something went wrong, sorry about that!');
				return;
			} else {
				// When the query returns no items (user has not logged anything yet)
				if (data.Items.length === 0) {
					msg.reply(
						"You don't have any logged message! Start today by typing `$logday`!"
					);
					return;
				} else {
					// Iterate over the returned objects, creating of log objects and an array of ordered dates
					data.Items.forEach(function (element, index) {
						const logBody = {
							name: `Day ${index + 1}   |   ${element.log_date}`,
							value: element.message,
						};
						logHistory = [...logHistory, logBody];
						logDates = [...logDates, element.log_date];
					});

					// Actual logs to be showed.
					// We still need to query the others to calculate the log streak
					const newLog = logHistory.slice(
						Math.max(
							logHistory.length -
								Math.min(logHistory.length, numberOfLogs),
							0
						)
					);

					// Gets the current streak of consecutive days with a log
					function currentStreak(arr) {
						// Streak counter
						let count = 0;
						const UNIX_DAY = 86400000;

						// We reverse the date array and check for each date if there's exactly a difference of 1 day * the current element's index
						// First day would be (1 day) * 0, same day
						// Second day would be (1 day) * 1, yesterday
						// And so on until we don't have a match, at which point we know we don't have a streak anymore and we can just return the count
						arr.reverse().forEach((date, i) => {
							if (
								new Date().setUTCHours(0, 0, 0, 0) -
									new Date(date).setUTCHours(0, 0, 0, 0) ===
								i * UNIX_DAY
							)
								count += 1;
						});
						return count;
					}

					// Creating the body of the embedded log history message
					const msgReply = new MessageEmbed()
						.setColor('#0099ff')
						.setThumbnail(msg.author.avatarURL())
						.setTitle(`${msg.author.username} log report`)
						.setDescription(
							`Showing ${Math.min(
								numberOfLogs,
								logHistory.length
							)} out of ${logHistory.length} logged days`
						)
						.addFields(
							...newLog,
							{
								name: 'Days completed',
								value: logHistory.length,
								inline: true,
							},
							{
								name: 'Current Streak',
								value: currentStreak(logDates),
								inline: true,
							}
						)
						.setTimestamp()
						.setFooter('Add a new log with `$logday`');

					msg.reply(msgReply);
					return;
				}
			}
		});
	}
});

// client.login logs the bot in and sets it up for use. You'll enter your token here.
client.login(process.env.DISCORD_TOKEN);
