const db = require("../../../models");
const mailer = require("../../../services/mailer");
const jwt = require("jsonwebtoken");
const schedule = require("node-schedule");
const Sequelize = require("sequelize");
const path = require("path");

const createTask = (req, res) => {
  console.log(req.body);
  let { tasks, userId, groupId } = req.body.params;
  console.log(tasks[0]);
  let mainTask = { ...tasks[0], ...{ type_task: db.Task.MAIN_TASK } };
  mainTask.end_date = mainTask.endDate;
  const taskOwner =
    mainTask.taskOwner === "Own" ? { user_id: userId } : { group_id: groupId };
  tasks.reverse().pop();
  const subTasks = tasks;

  db.Task.create({ ...mainTask, ...taskOwner })
    .then(async task => {
      console.log("new Task!!!");
      console.log(task.end_date);
      if (subTasks.length !== 0) {
        console.log("new subTasks!!!");

        await subTasks.forEach(subTask => {
          subTask.end_date = subTask.endDate;
          db.Task.create({
            ...subTask,
            ...taskOwner,
            ...{ parent_task_id: task.id, type_task: db.Task.SUB_TASK }
          });
          console.log("new subTask!!!!!!!");
        });
      }

      if (taskOwner.user_id) {
        await db.User.findOne({ where: { id: taskOwner.user_id } }).then(
          user => {
            console.log("-----------send to user --------------");
            sendMailNotifications([user], task);
          }
        );
      } else {
        await db.Group.findOne({
          where: { id: taskOwner.group_id },
          include: [{ model: db.User, as: "users" }]
        }).then(group => {
          console.log("-----------send to group --------------");
          sendMailNotifications(group.users, task);
        });
      }
      return task;
    })
    .then(task => res.status(200).send(task))
    .catch(error => {
      console.log("-------------------------");
      console.log(error);
      console.log("-------------------------");
      res.status(400).send(error);
    });
};

const uploadFiles = async (req, res) => {
  console.log("------------------IMAGE--REQUEST-------------------");
  console.log(req.body);
  
  const task = await db.Task.findOne({
    where: { id: req.body.id, parent_task_id: null },
    include: [{ model: db.Task, as: "subTasks" }]
  });
  
  console.log(req.files);
  
  for (var key in req.files) {
    let fileName = `${Date.now()}---${req.files[key].name}`;
    let splitedName = key.split("_")[1];
    if(splitedName == "main") {
      await req.files[key].mv(path.join(process.env.PWD, "uploads", fileName));
      await db.Task.update(
        {
          file_path: fileName
        },
        {
          where: { id: task.id }
        });
    } else {
      task.subTasks.forEach(async (st, ind) => {
        if(ind === Number(splitedName)) {
          await req.files[key].mv(path.join(process.env.PWD, "uploads", fileName));
          await db.Task.update(
            {
              file_path: fileName
            },
            {
              where: { id: st.id }
            });
        }
      });
    }
  }
  
  res.status(200).send({ message: "OK" });
  console.log("------------------IMAGE--REQUEST-------------------");
}

module.exports.uploadFiles = uploadFiles;

const sendMailNotifications = (users, mainTask) => {
  const date = new Date(mainTask.end_date);
  console.log("----------notification-schedule---------------");
  console.log(date);
  users.forEach((user, index) => {
    if (index > 0) {
      db.Notification.create({
        user_id: user.id,
        task_id: mainTask.id,
        type: "task_started",
        message: `You've a new ${mainTask.header} task`
      });
    }
    schedule.scheduleJob(date, () => {
      console.log("SENDING NOTIFICATION");
      db.Notification.create({
        user_id: user.id,
        task_id: mainTask.id,
        type: "task_finished",
        message: `Task ${mainTask.header} finished`
      });
      mailer.notifyToTask(user.email, mainTask);
    });
  });
};

module.exports.create = createTask;

const getTasks = (req, res) => {
  const find_by = req.query.user_id
    ? { user_id: req.query.user_id }
    : { group_id: req.query.group_id };
  if (find_by) {
    db.Task.findAll({
      where: { ...find_by, parent_task_id: null },
      include: [{ model: db.Task, as: "subTasks" }]
    }).then(tasks => {
      res.status(200).send(tasks);
    });
  }
};

module.exports.get = getTasks;

const taskDone = (req, res) => {
  console.log(req.body);
  const { taskId } = req.body;
  db.Task.update(
    {
      done_by: `${req.user.username}://${req.user.email}`,
      end_date: new Date()
    },
    {
      where: Sequelize.or({ id: taskId })
    }
  ).then(numUpdated => {
    db.Task.findOne({
      where: { id: taskId },
      include: [{ model: db.Task, as: "subTasks" }]
    }).then(async task => {
      if (task.user_id !== null) {
        await db.Notification.create({
          user_id: task.user_id,
          task_id: task.id,
          type: "task_finished",
          message: `Task ${task.header} finished`
        });
      }
      if (task.group_id !== null) {
        await db.User.findAll({
          where: {
            group_id: task.group_id
          }
        }).then(users => {
          users.forEach(async user => {
            await db.Notification.create({
              user_id: user.id,
              task_id: task.id,
              type: "task_finished",
              message: `Task ${task.header} finished`
            });
          });
        });
      }
      res.status(200).send(task);
    });
  });
};

module.exports.done = taskDone;

const deleteTask = (req, res) => {
  console.log(req.body);
  const { taskId } = req.body;
  db.Task.destroy({
    where: Sequelize.or({ id: taskId }, { parent_task_id: taskId })
  }).then(() => {
    res.status(200).send({ message: "Complete" });
  });
};

module.exports.delete = deleteTask;

const searchTasks = (req, res) => {
  const { text } = req.query;
  db.Task.findAll({
    where: 
      Sequelize.and(
        Sequelize.or(
          { header: { [Sequelize.Op.like]: `%${text}%` } },
          { content: { [Sequelize.Op.like]: `%${text}%` } }
        ), 
        Sequelize.or({ user_id: req.user.id }, { group_id: req.user.group_id })
      ), 
    include: [{ model: db.Task, as: "subTasks" }]
  }).then((tasks) => {
    res.status(200).send(tasks);
  });
};

module.exports.search = searchTasks;
