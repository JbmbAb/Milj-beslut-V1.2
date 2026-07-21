import os
import glob

# Resolve the current repository test directory from this script location.
test_dir = os.path.dirname(os.path.abspath(__file__))

# Define files to keep
keep_files = {
    "server.security.rateLimit.test.ts",
    "server.security.rateLimitDb.test.ts",
    "server.security.auditTrail.test.ts",
    "server.security.auditSanitization.test.ts",
    "server.security.projectAccess.test.ts",
    "server.repositories.projectAccessRepository.test.ts",
    "server.repositories.userRepository.test.ts",
    "server.repositories.requirementsRepository.test.ts",
    "server.services.completionService.test.ts",
    "server.services.bankIdService.test.ts"
}

# Get all .test.ts files
all_test_files = glob.glob(os.path.join(test_dir, "*.test.ts"))

print(f"Initial .test.ts files: {len(all_test_files)}")
print()

# Find files to delete
files_to_delete = []
for file_path in all_test_files:
    file_name = os.path.basename(file_path)
    if file_name not in keep_files:
        files_to_delete.append(file_path)

print(f"Files to delete: {len(files_to_delete)}")
print()

# Delete the files
delete_count = 0
for file_path in files_to_delete:
    try:
        os.remove(file_path)
        print(f"Deleted: {os.path.basename(file_path)}")
        delete_count += 1
    except Exception as e:
        print(f"ERROR deleting {os.path.basename(file_path)}: {e}")

print()
print(f"Total deleted: {delete_count} files")
print()

# Verify remaining files
remaining_files = glob.glob(os.path.join(test_dir, "*.test.ts"))
print(f"Remaining .test.ts files: {len(remaining_files)}")
print()
print("Remaining files (should be 10):")
remaining_names = sorted([os.path.basename(f) for f in remaining_files])
for name in remaining_names:
    print(f"  ✓ {name}")

print()

# Verify all kept files are present
missing_files = []
for keep_file in keep_files:
    file_path = os.path.join(test_dir, keep_file)
    if not os.path.exists(file_path):
        missing_files.append(keep_file)

if missing_files:
    print("ERROR: Missing files that should be kept:")
    for name in missing_files:
        print(f"  ✗ {name}")
else:
    print("✓ VERIFICATION PASSED: All 10 required files are present")
