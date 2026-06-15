-- Set department to 'HR' for all users with user_type = 'DRIVER'
UPDATE users SET department = 'HR' WHERE user_type = 'DRIVER';